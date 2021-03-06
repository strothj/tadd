import { gray, green, red } from "chalk";
import { difference, zip } from "lodash";
import * as ora from "ora";
import { EOL } from "os";
import * as timeSpan from "time-span";

import { hasTypings } from "./hasTypings";
import { Logger } from "./Logger";
import PackageReference from "./PackageReference";
import { isPackageInstalled, packageSemverString } from "./packageSemverString";
import IPackageManagerController from "./pm/IPackageManagerController";
import { packageManagerControllerFactory } from "./pm/packageManagerControllerFactory";
import { ShellExecutor } from "./ShellExecutor";
import { PACKAGE_MANAGER } from "./types";

interface ITaddConfig {
  packageManager: PACKAGE_MANAGER;
  verbose: boolean;
}

export default class Tadd {
  public readonly packageManagerController: IPackageManagerController;
  public readonly logger: Logger;
  private startTime: timeSpan.TimeSpanObject;

  constructor(private readonly config: ITaddConfig) {
    this.logger = new Logger();
    const commandExecutor = new ShellExecutor(this.logger);
    this.packageManagerController = packageManagerControllerFactory(
      config.packageManager,
      commandExecutor
    );
  }

  public async add(isDev: boolean, packages: PackageReference[]) {
    this.startTime = timeSpan();
    console.log(`Using: ${this.packageManagerController.formattedName()}`);

    const packageInstallingBar = ora(`Installing packages: ${green(packages.join(", "))}`).start();

    try {
      await this.packageManagerController.add(isDev, packages.map(p => p.toString()));
    } catch (e) {
      packageInstallingBar.fail();
      this.finishFailure(e);
    }
    packageInstallingBar.succeed();

    const packagesWithTypings = packages.filter(t => hasTypings(t.name));
    if (packagesWithTypings.length > 0) {
      console.log(gray(`Detected builtin typings: ${packagesWithTypings.join(", ")}`));
    }

    const packagesWithoutTypings = difference(packages, packagesWithTypings);
    if (packagesWithoutTypings.length === 0) {
      this.finishSuccess();
    }

    const typingsPackages = (await Promise.all(
      packagesWithoutTypings.map(packageSemverString)
    )).map(t => t.toTypingsPackage());
    const typingsInstallingBar = ora(`Installing typings: ${typingsPackages.join(", ")}`).start();
    try {
      await this.packageManagerController.add(true, typingsPackages.map(p => p.toString()));
      typingsInstallingBar.succeed();
    } catch (e) {
      typingsInstallingBar.fail();

      await this.installAnyVersion(typingsPackages);
      return;
    }
    this.finishSuccess();
  }

  private async installAnyVersion(packages: PackageReference[]) {
    const checkPackageInstallationStatus = await Promise.all(packages.map(isPackageInstalled));
    const notInstalledPackages: PackageReference[] = zip(
      checkPackageInstallationStatus,
      packages as any
    )
      .filter(x => !x[0])
      .map(x => x[1]) as any;
    console.log("Couldn't find exact typings for: ", notInstalledPackages.join(", "));
    const anyVersionPackage = notInstalledPackages.map(ref => ref.toWithoutVersion());

    const typingsInstallingBar = ora(`Installing typings for any version.`).start();
    try {
      await this.packageManagerController.add(true, anyVersionPackage.map(p => p.toString()));
      typingsInstallingBar.succeed();
      this.finishSuccess();
    } catch (e) {
      typingsInstallingBar.fail();
      this.finishFailure(e);
    }
  }

  private finishSuccess() {
    if (this.config.verbose) {
      console.log(gray("Commands executed:"));
      console.log(this.logger.cmdOutputLogs.join(EOL));
    }

    const duration = this.startTime();

    console.log(gray(`Commands executed:${EOL}${this.logger.cmdLogs.join(EOL)}`));
    console.log(green(`💎  All good! Took ${(duration / 1000).toFixed(2)}s.`));
    process.exit(0);
  }

  private finishFailure(e: Error) {
    // tslint:disable-next-line
    console.log(red("Error occurred!"));
    // tslint:disable-next-line
    console.log(e);
    process.exit(0);
  }
}
