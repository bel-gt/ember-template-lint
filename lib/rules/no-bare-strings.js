'use strict';

const fs = require('fs');
const path = require('path');

/*
 Disallows the use of bare strings in a template

 ```
 {{!-- good  --}}
 <div>{{evaluatesToAString}}</div>
 <div>{{'A string'}}</div>

 {{!-- bad --}}
 <div>A bare string</div>
 ```

 The following values are valid configuration:

   * boolean -- `true` for enabled / `false` for disabled
   * array -- an array of allowlisted strings
   * object -- An object with the following keys:
     * `allowlist` -- An array of allowlisted strings
     * `whitelist` -- Deprecated, use `allowlist`. If both are provided, `whitelist` will be ignored.
     * `globalAttributes` -- An array of attributes to check on every element.
     * `elementAttributes` -- An object whose keys are tag names and value is an array of attributes to check for that tag name.
 */

const createErrorMessage = require('../helpers/create-error-message');
const Rule = require('./base');

const GLOBAL_ATTRIBUTES = [
  'title',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
];

const TAG_ATTRIBUTES = {
  input: ['placeholder'],
  img: ['alt'],
};

const DEFAULT_ALLOWLIST = [
  '&lpar;', // (
  '&rpar;', // )
  '&comma;', // ,
  '&period;', // .
  '&amp;', // &
  '&AMP;', // &
  '&plus;', // +
  '&minus;', // -
  '&equals;', // =
  '&ast;', // *
  '&midast;', // *
  '&sol;', // /
  '&num;', // #
  '&percnt;', // %
  '&excl;', // !
  '&quest;', // ?
  '&colon;', // :
  '&lsqb;', // [
  '&lbrack;', // [
  '&rsqb;', // ]
  '&rbrack;', // ]
  '&lcub;', // {
  '&lbrace;', // {
  '&rcub;', // }
  '&rbrace;', // }
  '&lt;', // <
  '&LT;', // <
  '&gt;', // >
  '&GT;', // >
  '&bull;', // •
  '&bullet;', // •
  '&mdash;', // —
  '&ndash;', // –
  '&nbsp;', // non-breaking space
  '&Tab;',
  '&NewLine;',
  '&verbar;', // |
  '&vert;', // |
  '&VerticalLine;', // |
  '(',
  ')',
  ',',
  '.',
  '&',
  '+',
  '-',
  '=',
  '*',
  '/',
  '#',
  '%',
  '!',
  '?',
  ':',
  '[',
  ']',
  '{',
  '}',
  '<',
  '>',
  '•',
  '—',
  ' ',
  '|',
];

const IGNORED_ELEMENTS = new Set(['pre', 'script', 'style', 'template', 'textarea']);

// Character entity reference chart: https://dev.w3.org/html5/html-author/charref
const DEFAULT_CONFIG = {
  allowlist: DEFAULT_ALLOWLIST,
  whitelist: DEFAULT_ALLOWLIST,
  globalAttributes: GLOBAL_ATTRIBUTES,
  elementAttributes: TAG_ATTRIBUTES,
};

function isValidConfigObjectFormat(config) {
  for (let key in config) {
    let value = config[key];
    let valueType = typeof value;
    let valueIsArray = Array.isArray(value);

    if ((key === 'allowlist' || key === 'whitelist') && !valueIsArray) {
      return false;
    } else if (key === 'globalAttributes' && !valueIsArray) {
      return false;
    } else if (key === 'elementAttributes' && valueType === 'object') {
      if (valueIsArray) {
        return false;
      }
    } else if (!DEFAULT_CONFIG[key]) {
      return false;
    }
  }

  return true;
}

function sanitizeConfigArray(allowlist = []) {
  return allowlist.filter((option) => option !== '').sort((a, b) => b.length - a.length);
}

module.exports = class NoBareStrings extends Rule {
  constructor(options) {
    super(options);
    this._elementStack = [];
  }

  isWithinIgnoredElement() {
    return this._elementStack.some((n) => IGNORED_ELEMENTS.has(n.tag));
  }
  parseConfig(config) {
    let configType = typeof config;

    switch (configType) {
      case 'boolean':
        // if `true` use `DEFAULT_CONFIG`
        return config ? DEFAULT_CONFIG : false;
      case 'object':
        if (Array.isArray(config)) {
          return {
            allowlist: sanitizeConfigArray(config),
            globalAttributes: GLOBAL_ATTRIBUTES,
            elementAttributes: TAG_ATTRIBUTES,
          };
        } else if (isValidConfigObjectFormat(config)) {
          // default any missing keys to empty values
          let { allowlist = [], whitelist = [] } = config;
          let allowlistToUse =
            [allowlist, whitelist].find((list) => {
              return Array.isArray(list) && list.length;
            }) || [];
          return {
            allowlist: sanitizeConfigArray(allowlistToUse),
            globalAttributes: config.globalAttributes || [],
            elementAttributes: config.elementAttributes || {},
          };
        }
        break;
      case 'undefined':
        return false;
    }

    let errorMessage = createErrorMessage(
      this.ruleName,
      [
        '  * boolean - `true` to enable / `false` to disable',
        '  * array -- an array of allowlisted strings',
        '  * object -- An object with the following keys:',
        '    * `allowlist` -- An array of allowlisted strings',
        '    * `globalAttributes` -- An array of attributes to check on every element',
        '    * `elementAttributes` -- An object whose keys are tag names and value is an array of attributes to check for that tag name',
      ],
      config
    );

    throw new Error(errorMessage);
  }

  visitor() {
    return {
      TextNode(node, path) {
        if (!node.loc) {
          return;
        }

        let parents = [...path.parents()];
        let attrPath = parents.find((it) => it.node.type === 'AttrNode');
        if (attrPath) {
          this._getBareStringAttribute(attrPath.node, path);
        } else {
          this._inspectNode(node, '', node.loc, path);
        }
      },

      ElementNode: {
        enter(node) {
          this._currentElementNode = node;
          this._elementStack.push(node);
        },
        exit() {
          this._elementStack.pop();
        },
      },
      MustacheStatement(node, path) {
        let parents = [...path.parents()];
        if (!parents.some((it) => it.node.type === 'AttrNode')) {
          this._inspectNode(node.path, '', node.loc, path);
        }
      },
    };
  }

  _getBareStringAttribute(attribute, path) {
    let tag = this._currentElementNode.tag;
    let attributeType = attribute.name;
    let attributeValueNode = attribute.value;
    let additionalDescription = ` in \`${attributeType}\` attribute`;
    let isGlobalAttribute = this.config.globalAttributes.includes(attributeType);
    let isElementAttribute =
      this.config.elementAttributes[tag] &&
      this.config.elementAttributes[tag].includes(attributeType);

    if (isGlobalAttribute || isElementAttribute) {
      this._inspectNode(attributeValueNode, additionalDescription, attribute.loc, path);
    }
  }

  _getBareString(_string) {
    let allowlist = this.config.allowlist;
    let string = _string;

    if (allowlist) {
      for (const entry of allowlist) {
        while (string.includes(entry)) {
          string = string.replace(entry, '');
        }
      }
    }

    return string.trim() !== '' ? _string : null;
  }

  _inspectNode(node, additionalDescription, loc, path) {
    if (this._currentElementNode && this.isWithinIgnoredElement()) {
      return;
    }
    if (node.type === 'TextNode') {
      let bareStringText = this._getBareString(node.chars);

      if (bareStringText) {
        this._fixOrLog(node, additionalDescription, loc, bareStringText, path);
      }
    } else if (node.type === 'ConcatStatement') {
      for (let i = 0; i < node.parts.length; i++) {
        let subNode = node.parts[i];
        this._inspectNode(subNode, additionalDescription, loc, path);
      }
    } else if (node.type === 'StringLiteral') {
      let bareStringText = this._getBareString(node.value);

      if (bareStringText) {
        this._fixOrLog(node, additionalDescription, loc, bareStringText, path);
      }
    }
  }

  _fixOrLog(node, additionalDescription, loc, bareStringText, path) {
    if (this.mode === 'fix') {
      this._fix(node, path, bareStringText);
    } else {
      this._log(additionalDescription, loc, bareStringText);
    }
  }

  _fix(node, path, bareStringText) {
    if (node.type === 'TextNode') {
      const trimmed = bareStringText.trim();
      const key = this._addStringToTranslations(trimmed)
      if (key) {
        path.node.chars = `{{t '${key}'}}`;
      }
    }
  }

  _log(additionalDescription, loc, bareStringText) {
    this.log({
      message: `Non-translated string used${additionalDescription}`,
      isFixable: true,
      line: loc.start.line,
      column: loc.start.column,
      source: bareStringText,
    });
  }

  /**
   * @param {String} string the string to be added to the ember-intl translations file.
   * @param {String} locale the ember-intl locale, used to derive the file path.
   * @returns {String} a dot delimeted key path for the translation.
   */
  _addStringToTranslations(string, locale = 'en') {
    const keyPathSegments = this._filePath.split(path.sep);
    keyPathSegments.pop();
    keyPathSegments.shift();
    const keyPath = [...keyPathSegments, string].join('.')
    const cwd = process.cwd();
    const filePathSegments = [cwd, 'translations', `${locale}.json`];
    const filePath = path.join(...filePathSegments);
    if (fs.existsSync(filePath)) {
      try {
        const fileContents = fs.readFileSync(filePath);
        const translations = JSON.parse(fileContents);
        const parent = keyPathSegments.reduce((acc, currentValue) => {
          acc[currentValue] = acc[currentValue] || {};
          return acc[currentValue];
        }, translations);
        parent[string] = string;
        fs.writeFileSync(filePath, JSON.stringify(translations, null, 2));
        return keyPath;
      } catch (error) {
        console.error(error); // eslint-disable-line no-console
        return null;
      }
    }
  }
};

module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
