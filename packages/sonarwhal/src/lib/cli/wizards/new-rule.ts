import * as path from 'path';
import { promisify } from 'util';

import * as Handlebars from 'handlebars';
import * as fs from 'fs-extra';
import * as inquirer from 'inquirer';
import * as mkdirp from 'mkdirp';

import { CLIOptions } from '../../types';
import { Category } from '../../enums/category';
import { RuleScope } from '../../enums/rulescope';
import * as logger from '../../utils/logging';
import { isOfficial, normalizeStringByDelimiter, readFile, writeFileAsync, toCamelCase, toPascalCase } from '../../utils/misc';
import { escapeSafeString, compileTemplate, sonarwhalPackage } from '../../utils/handlebars';

/*
 * ------------------------------------------------------------------------------
 * Types.
 * ------------------------------------------------------------------------------
 */

/** A map that matches usecases with events. */
const events: Map<string, Array<string>> = new Map([
    ['dom', ['ElementFound']],
    ['request', ['FetchStart', 'FetchEnd', 'FetchError']],
    ['thirdPartyService', ['FetchStart', 'FetchEnd']],
    ['jsInjection', ['ScanEnd']]
]);

/**  Usage categories that the new rule applies to */
export type UseCase = {
    /**  Rule applies to DOM */
    dom: boolean;
    /**  Rule applies to resource request */
    request: boolean;
    /**  Rule applies to third party service */
    thirdPartyService: boolean;
    /**  Rule applies to JS injection */
    jsInjection: boolean;
};

/** Generate a new rule */
export interface INewRule {
    /** Name of the new rule */
    name: string;
    /** Name of the rule normalized */
    normalizedName: string;
    /** Category of the new rule */
    category: Category;
    /** Description of the new rule */
    description: hbs.SafeString;
    /** Element type if `dom` is selected in useCase */
    elementType?: string;
    /** Events that should be subscribed to */
    events: string;
    /** Usage categories that the new rule applies to */
    useCase?: UseCase;
    /** If the rule works with local files */
    scope: RuleScope;
    /** If a rule is external */
    external: Boolean;
    /** Parent name for multi rules packages */
    parentName: string;
}

export enum QuestionsType {
    /** Main questions to create a simple rules or a package with multiples rules */
    main = 'main',
    /** Questions to add more rules to the package */
    rule = 'rule'
}

/*
 * ------------------------------------------------------------------------------
 * Classes and dependencies.
 * ------------------------------------------------------------------------------
 */

/** Get all events associted with a particular use case. */
const getEventsByUseCase = (useCase: string): string => {
    return events.get(useCase).join(', ');
};

class NewRule implements INewRule {
    public name: string;
    public normalizedName: string;
    public className: string;
    public category: Category;
    public description: hbs.SafeString;
    public elementType?: string;
    public events: string;
    public useCase?: UseCase;
    public prefix: string;
    public scope: RuleScope;
    public external: Boolean;
    public isRule: Boolean = true;
    public parentName: string;

    public constructor(ruleData: inquirer.Answers, parentName?: string) {
        this.name = ruleData.name;
        this.normalizedName = normalizeStringByDelimiter(ruleData.name, '-');
        this.className = `${parentName ? toPascalCase(parentName) : ''}${toPascalCase(this.normalizedName)}Rule`;
        this.category = ruleData.category || Category.other;
        this.description = escapeSafeString(ruleData.description);
        this.elementType = ruleData.elementType;
        this.events = getEventsByUseCase(ruleData.useCase);
        this.useCase = {
            dom: false,
            jsInjection: false,
            request: false,
            thirdPartyService: false
        };
        this.useCase[ruleData.useCase] = true;
        this.scope = ruleData.scope;
        this.parentName = parentName;
    }
}

class RulePackage {
    public name: string;
    public description: hbs.SafeString;
    public isMulti: boolean;
    public normalizedName: string;
    public official: boolean;
    public packageMain: string;
    public packageName: string;
    public rules: Array<INewRule>;
    public version: string;
    public destination: string;
    public isRule: boolean = true;

    public constructor(data: inquirer.Answers) {
        this.name = data.name;
        this.isMulti = data.multi;
        this.normalizedName = normalizeStringByDelimiter(data.name, '-');
        this.description = escapeSafeString(data.description);
        this.official = data.official;
        this.packageMain = `dist/src/index.js`; // package.json#main

        const prefix = this.official ? '@sonarwhal/' : 'sonarwhal-'; // package.json#name

        this.packageName = `${prefix}rule-${this.normalizedName}`;
        this.version = sonarwhalPackage.version;
        this.rules = [];

        if (this.isMulti) {
            data.rules.forEach((rule) => {
                this.rules.push(new NewRule(rule, this.normalizedName));
            });
        } else {
            this.rules.push(new NewRule(data));
        }

        this.destination = path.join(process.cwd(), `rule-${this.normalizedName}`);
    }
}

/*
 * ------------------------------------------------------------------------------
 * Constants and Private functions.
 * ------------------------------------------------------------------------------
 */

const mkdirpAsync = promisify(mkdirp);
/** Name of the package to use as a template. */
const TEMPLATE_PATH = './templates/new-rule';
const SHARED_TEMPLATE_PATH = './shared-templates';

const partialEventCode = require('./templates/new-rule/partial-event-code.hbs');

Handlebars.registerPartial('event-code', partialEventCode);
Handlebars.registerHelper('toCamelCase', toCamelCase);

/** List rule categories. */
const categories = [];

for (const [, value] of Object.entries(Category)) {
    if (value !== 'other') {
        categories.push({ name: value });
    }
}

/** List of scopes */
const scopes = [];

for (const [, value] of Object.entries(RuleScope)) {
    if (value !== 'other') {
        scopes.push({ name: value });
    }
}

/** List of different use cases of a rule. */
const useCases = [
    {
        name: 'DOM',
        value: 'dom'
    },
    {
        name: 'Resource Request',
        value: 'request'
    },
    {
        name: 'Third Party Service',
        value: 'thirdPartyService'
    },
    {
        name: 'JS injection',
        value: 'jsInjection'
    }
];

/** List of questions to prompt the user. */
export const questions = (type: QuestionsType) => {
    const notEmpty = (value) => {
        return value.trim() !== '';
    };

    return [{
        message: `Is this a package with multiple rules? (yes)`,
        name: 'multi',
        type: 'confirm',
        when: () => {
            return type === QuestionsType.main;
        }
    },
    {
        default(answers) {
            return answers.multi ? 'newPackage' : 'newRule';
        },
        message(answers) {
            return `What's the name of this new ${answers.multi ? 'package' : 'rule'}?`;
        },
        name: 'name',
        type: 'input',
        validate: notEmpty
    },
    {
        default(answers) {
            return `Description for ${answers.name}`;
        },
        message(answers) {
            return `What's the description of this new ${answers.multi ? 'package' : 'rule'} '${answers.name}'?`;
        },
        name: 'description',
        type: 'input',
        validate: notEmpty
    },
    {
        choices: categories,
        default: Category.interoperability,
        message: 'Please select the category of this new rule:',
        name: 'category',
        type: 'list',
        when(answers) {
            return !answers.multi;
        }
    },
    {
        choices: useCases,
        default: 'dom',
        message: 'Please select the category of use case:',
        name: 'useCase',
        type: 'list',
        when(answers) {
            return !answers.multi;
        }
    },
    {
        default: 'div',
        message: 'What DOM element does the rule need access to?',
        name: 'elementType',
        type: 'input',
        validate: notEmpty,
        when: (answers) => {
            return answers.useCase === 'dom';
        }
    },
    {
        choices: scopes,
        default: RuleScope.any,
        message: 'Please select the scope of this new rule:',
        name: 'scope',
        type: 'list',
        when(answers) {
            return !answers.multi;
        }
    },
    {
        default: true,
        message: 'Want to add more rules (yes)?',
        name: 'again',
        type: 'confirm',
        when: () => {
            return type === QuestionsType.rule;
        }
    }];
};

/** Copies the required files for no official rules. */
const copyFiles = async (origin: string, destination: string) => {

    logger.log(`Creating new rule in ${destination}`);
    await fs.copy(origin, destination);
    logger.log('External files copied');
};

const generateRuleFiles = async (destination: string, data) => {
    const commonFiles = [
        {
            destination: path.join(destination, 'src', `index.ts`),
            path: path.join(__dirname, TEMPLATE_PATH, 'index.ts.hbs')
        },
        {
            destination: path.join(destination, 'README.md'),
            path: path.join(__dirname, TEMPLATE_PATH, 'readme.md.hbs')
        },
        {
            destination: path.join(destination, 'tsconfig.json'),
            path: path.join(__dirname, SHARED_TEMPLATE_PATH, 'tsconfig.json.hbs')
        },
        {
            destination: path.join(destination, 'package.json'),
            path: path.join(__dirname, SHARED_TEMPLATE_PATH, 'package.hbs')
        }];

    if (!data.official) {
        commonFiles.push({
            destination: path.join(destination, '.sonarwhalrc'),
            path: path.join(__dirname, SHARED_TEMPLATE_PATH, 'config.hbs')
        });
    }

    const ruleFile = {
        destination: path.join(destination, 'src'),
        path: path.join(__dirname, TEMPLATE_PATH, 'rule.ts.hbs')
    };
    const testFile = {
        destination: path.join(destination, 'tests'),
        path: path.join(__dirname, TEMPLATE_PATH, 'tests.ts.hbs')
    };
    const docFile = {
        destination: path.join(destination, 'docs'),
        path: path.join(__dirname, TEMPLATE_PATH, 'rule-doc.hbs')
    };

    for (const file of commonFiles) {
        const { destination: dest, path: p } = file;

        const fileContent = await compileTemplate(p, data);

        await mkdirpAsync(path.dirname(dest));
        await writeFileAsync(dest, fileContent);
    }

    for (const rule of data.rules) {
        const [ruleContent, testContent] = await Promise.all([compileTemplate(ruleFile.path, rule), compileTemplate(testFile.path, rule)]);

        // e.g.: rule-ssllabs/src/ssllabs.ts
        const rulePath = path.join(ruleFile.destination, `${rule.normalizedName}.ts`);
        // e.g.: rule-ssllabs/tests/ssllabs.ts
        const testPath = path.join(testFile.destination, `${rule.normalizedName}.ts`);
        // e.g.: rule-typescript-config/docs/is-valid.ts
        const docPath = path.join(docFile.destination, `${rule.normalizedName}.md`);

        await Promise.all([mkdirpAsync(path.dirname(rulePath)), mkdirpAsync(path.dirname(testPath))]);

        await Promise.all([writeFileAsync(rulePath, ruleContent), writeFileAsync(testPath, testContent)]);

        if (data.isMulti) {
            const docContent = await compileTemplate(docFile.path, rule);

            await mkdirpAsync(path.dirname(docPath));
            await writeFileAsync(docPath, docContent);
        }
    }
};

/** Add a new rule. */
export const newRule = async (actions: CLIOptions): Promise<boolean> => {
    if (!actions.newRule) {
        return false;
    }

    try {
        const results = await inquirer.prompt(questions(QuestionsType.main));
        const rules = [];

        results.official = await isOfficial();

        const askRules = async () => {
            const rule = await inquirer.prompt(questions(QuestionsType.rule));

            rules.push(rule);

            if (rule.again) {
                await askRules();
            }
        };

        if (results.multi) {
            await askRules();
        }

        results.rules = rules;

        const rulePackage = new RulePackage(results);
        const noOfficialOrigin: string = path.join(__dirname, 'no-official-files');
        const files: string = path.join(__dirname, 'files');

        if (!rulePackage.official) {
            await copyFiles(noOfficialOrigin, rulePackage.destination);
        }
        await copyFiles(files, rulePackage.destination);
        await generateRuleFiles(rulePackage.destination, rulePackage);

        logger.log(`
New ${rulePackage.isMulti ? 'package' : 'rule'} ${rulePackage.name} created in ${rulePackage.destination}

--------------------------------------
----          How to use          ----
--------------------------------------`);

        if (rulePackage.official) {
            logger.log(`1. Run 'yarn' to install the dependencies.
2. Go to the folder 'packages/rule-${rulePackage.normalizedName}'.
3. Run 'yarn build' to build the project.
4. Go to the folder 'packages/sonarwhal'.
5. Add your rule to '.sonarwhalrc'.
6. Run 'yarn sonarwhal https://YourUrl' to analyze your site.`);
        } else {
            logger.log(`1. Go to the folder 'rule-${rulePackage.normalizedName}'.
2. Run 'npm run init' to install all the dependencies and build the project.
3. Run 'npm run sonarwhal -- https://YourUrl' to analyze you site.`);
        }

        return true;
    } catch (e) {
        /* istanbul ignore next */
        logger.error('Error trying to create new rule');
        logger.error(e);

        return false;
    }
};
