import { join } from 'path'; //eslint-disable-line

import * as Handlebars from 'handlebars';

import { debug as d } from './debug';
import { readFileAsync } from './misc';
import { findPackageRoot } from './misc';

const debug = d(__filename);
const packageLocation = join(findPackageRoot(), 'package.json').replace(/\\/g, '\\\\');

debug(`Package location: ${packageLocation}`);

export const sonarwhalPackage = eval(`require('${packageLocation}');`); //eslint-disable-line

// export const sonarwhalPackage = require(join(findPackageRoot(), 'package.json'));

/**
 * Searches the current version used for a package in `sonarwhal` and uses that version or the `defaultVersion`.
 *
 * This is used when creating a new rule via the CLI to make sure the dependencies are up-to-date in the moment
 * of creation.
 */
Handlebars.registerHelper('dependencyVersion', (packageName, defaultVersion): string => {
    return sonarwhalPackage.dependencies[packageName] || sonarwhalPackage.devDependencies[packageName] || defaultVersion;
});

/**
 * Use `escapeSafeString` function instead of triple curly brace in the templates
 * to escape the backticks (`) in the user's input.
 * Example:
 * ```
 * description: `This is a \`important\` rule that has 'single' and "double" quotes.`
 * ```
 */
export const escapeSafeString = (str: string): hbs.SafeString => {
    const result = str.replace(/(`)/g, '\\$1');

    return new Handlebars.SafeString(result);
};

export const compileTemplate = async (filePath: string, data): Promise<string> => {
    let templateContent;

    try {
        templateContent = await readFileAsync(filePath);
    } catch (err) {
        debug(`Error reading file: ${filePath}`);
        throw (err);
    }

    const template = Handlebars.compile(templateContent);

    return template(data);
};
