/**
 * Spellcheck module
 */
SpellcheckService.$inject = ['$q', 'api', 'dictionaries', '$rootScope', '$location', 'lodash'];
function SpellcheckService($q, api, dictionaries, $rootScope, $location, _) {
    var lang,
        dict,
        ignored = {},
        abbreviationList = [],
        self;

    let _activeCache = {};

    self = this;
    self.abbreviationsDict = null;
    /**
     * Set current language
     *
     * @param {string} _lang
     */
    this.setLanguage = function(_lang) {
        if (lang !== _lang) {
            lang = _lang;
            dict = null;
        }
    };

    /**
     * Gets the base language (en) of different culture
     * specific (en-AU) language
     *
     * @param {string} language
     * @return {string}
     */
    function getBaseLanguage(language) {
        if (language && language.indexOf('-') > 0) {
            return language.split('-')[0];
        }

        return null;
    }

    /**
     * Get dictionary for spellchecking
     *
     * @return {Promise}
     */
    function getDict() {
        if (!lang) {
            return $q.reject();
        }

        var baseLang = getBaseLanguage(lang);

        if (!dict) {
            dict = dictionaries.getActive(lang, baseLang).then((items) => {
                dict = dict || {};
                dict.content = {};

                let langItems = items;

                if (baseLang && _.find(items, {language_id: lang}) && _.find(items, {language_id: baseLang})) {
                    langItems = _.filter(items, {language_id: lang});
                }

                angular.forEach(langItems, addDict);

                // Abbreviations found in dictionary.
                var re = /\w+(?:\.\w*)+/g;

                abbreviationList = _.words(Object.keys(dict.content), re);

                return dict.content;
            });
        }

        return dict;
    }

    /*
     * Return dictionaries for requested language
     *
     * @param {Object} lang
     * @returns {Object} List of dictionaries
     */
    this.getDictionary = function(lang) {
        if (!_activeCache[lang]) {
            _activeCache[lang] = dictionaries.getActive(lang, getBaseLanguage(lang));
        }

        return _activeCache[lang];
    };

    /**
     * Get abbreviations for replacement
     *
     * @return {Promise}
     */
    this.getAbbreviationsDict = function(force) {
        if (!lang) {
            // here it shouldn't reject like in getDict, where it would stop only spellchecking
            // if there is no dictionary, while here it would stop scope commit in editor
            return $q.when({});
        }

        var baseLang = getBaseLanguage(lang);

        if (!self.abbreviationsDict || force) {
            return dictionaries.getUserAbbreviations(lang, baseLang).then((items) => {
                self.abbreviationsDict = self.abbreviationsDict || {};
                self.abbreviationsDict.content = {};

                let langItems = items;

                if (baseLang && _.find(items, {language_id: lang}) && _.find(items, {language_id: baseLang})) {
                    langItems = _.filter(items, {language_id: lang});
                }

                angular.forEach(langItems, (item) => {
                    angular.extend(self.abbreviationsDict.content, JSON.parse(item.content) || {});
                });

                return self.abbreviationsDict.content;
            });
        }

        return $q.when(self.abbreviationsDict.content);
    };

    function updateAbbreviations(data) {
        if (self.abbreviationsDict && self.abbreviationsDict.content) {
            angular.extend(self.abbreviationsDict.content, data || {});
        }
    }

    $rootScope.$on('abbreviations:updated', angular.bind(self, (evt, data) => {
        updateAbbreviations(data);
    }));

    /**
     * Reset active dictionary cache
     *
     * When it gets langauge info, only reset it for given langauge,
     * otherwise reset it for all languages.
     *
     * @param {Event} event
     * @param {Object} data
     */
    let _resetActiveCache = (event, data) => {
        if (data.language) {
            _activeCache[data.language] = null;
        } else {
            _activeCache = {};
        }
    };

    $rootScope.$on('dictionary:created', _resetActiveCache);
    $rootScope.$on('dictionary:updated', _resetActiveCache);

    /**
     * Add dictionary content to spellcheck
     *
     * @param {Object} item
     */
    function addDict(item, _lang) {
        angular.extend(dict.content, item.content || {});
    }

    /**
     * Get words that come after an abbreviation.
     *
     * @param {string} textContent
     * @param {integer} currentOffset
     * @return {Object} - list of non sentence words.
     *     {
     *       index: word
     *     }
     */
    function getNonSentenceWords(textContent, currentOffset) {
        // words contains one or more periods in content. e.g., E.N.T., Aborig. or etc.
        var reAbbreviations = /\w+(?:\.\w*)+/g;
        var abbreviationWords = _.words(textContent, reAbbreviations);

        // consider only abbreviations in content that found in dictionary
        var _abbrevArr = [];

        _.forEach(abbreviationWords, (abbrevWord) => {
            _.filter(abbreviationList, (item) => {
                if (item === abbrevWord) {
                    _abbrevArr.push(abbrevWord);
                }
            });
        });
        var _abbreviationString = _abbrevArr.join('|');

        // Prepare non sentence words
        var match, wordIndex;
        var nonSentenceWords = [];

        // Words that come after an abbreviation in content.
        var _reNonSentenceWords = '\\s+(?:' + _abbreviationString + ')(\\s+\\w+)';
        var reNonSentenceWords = new RegExp(_reNonSentenceWords, 'g');

        while (!_.isNil(match = reNonSentenceWords.exec(textContent))) {
            wordIndex = match.index + match[0].indexOf(_.trim(match[1]));
            nonSentenceWords[currentOffset + wordIndex] = _.trim(match[1]);
        }

        return nonSentenceWords;
    }

    /**
     * Get words that contributing beginning of sentences.
     * excluding words that come after an abbreviation.
     *
     * @param {string} textContent
     * @param {integer} currentOffset
     * @return {Object} - list of sentence words.
     *     {
     *       index: word
     *     }
     */
    function getSentenceWords(textContent, currentOffset) {
        var reSentenceWords = /(?:^\s*|(?:[.|?|!|:]\s*))(\w+)/g; // words come after by .|?|!|:
        var match, wordIndex;
        var sentenceWords = {};
        // Replace quotes (",“,”,‘,’,'), that might occur at start/end of sentence/paragraph before applying regex.

        while (!_.isNil(match = reSentenceWords.exec(textContent.replace(/["“”‘’']/g, ' ')))) {
            wordIndex = match.index + match[0].indexOf(match[1]);
            sentenceWords[currentOffset + wordIndex] = match[1];
        }

        // Excluding the words from sentence word if come after an abbreviation.
        var nonSentenceWords = getNonSentenceWords(textContent, currentOffset);

        sentenceWords = _.omit(sentenceWords, Object.keys(nonSentenceWords));

        return sentenceWords;
    }

    /**
     * Test if word exists in dictionary
     *
     * @param {String} word
     * @param {Boolean} i - if true tests case in-sensitive
     * @return {Boolean}
     */
    function wordExistInDict(word, i) {
        if (i) {
            var lowerCaseWord = word.toLowerCase();

            return _.find(Object.keys(dict.content), (val) => val.toLowerCase() === lowerCaseWord);
        }

        return dict.content[word];
    }

    /**
     * Test if word is a spelling mistake
     *
     * @param {String} word
     * @param {Boolean} sentenceWord - it's first word in a sentence
     * @return {Boolean}
     */
    function isSpellingMistake(word, sentenceWord) {
        if (sentenceWord && !isFirstLetterCapital(word)) {
            return true; // first word in sentence should be capital
        } else if (sentenceWord && isFirstLetterCapital(word)) {
            // first word, maybe it is in dict with capital, maybe not, check both
            var lowercase = word[0].toLowerCase() + word.slice(1);

            return !wordExistInDict(word) && !wordExistInDict(lowercase);
        }

        // check it as it is
        return !wordExistInDict(word);
    }

    /**
     * Test if first letter of word is uppercase
     *
     * @param {String} word
     * @return {Boolean}
     */
    function isFirstLetterCapital(word) {
        return word[0] === word[0].toUpperCase();
    }

    /**
     * Find errors in given node
     *
     * @param {Node} node
     */
    this.errors = function check(node) {
        return getDict().then((d) => {
            var errors = [],
                regexp = /[0-9a-zA-Z\u00C0-\u1FFF\u2C00-\uD7FF]+/g,
                dblSpacesRegExp = /\S(\s{2,})\S/g,
                match,
                dblSpacesMatch,
                currentOffset = 0,
                tree = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);

            var objSentenceWords = getSentenceWords(node.textContent, currentOffset);

            while (tree.nextNode()) {
                while (!_.isNil(dblSpacesMatch = dblSpacesRegExp.exec(tree.currentNode.textContent))) {
                    var dblSpace = dblSpacesMatch[1];

                    errors.push({
                        word: dblSpace,
                        index: currentOffset + dblSpacesMatch.index + 1,
                        sentenceWord: false
                    });
                }

                while (!_.isNil(match = regexp.exec(tree.currentNode.textContent))) {
                    var word = match[0];
                    var isSentenceWord = !!objSentenceWords[currentOffset + match.index];

                    if (isNaN(word) && !isIgnored(word) && isSpellingMistake(word, isSentenceWord)) {
                        errors.push({
                            word: word,
                            index: currentOffset + match.index,
                            sentenceWord: isSentenceWord
                        });
                    }
                }
                currentOffset += tree.currentNode.length;
            }

            return errors;
        });
    };

    /**
     * Get suggested corrections for given word
     *
     * @param {string} word
     */
    this.suggest = function suggest(word) {
        if (word.match(/^\s+$/i)) {
            return Promise.resolve([{key: ' ', value: 'Add single space'}]);
        }

        return api.save('spellcheck', {
            word: word,
            language_id: lang
        }).then((result) => {
            var allDict = getDict();
            var wordFoundInDict = _.pick(allDict.content, (value, key) => {
                if (key.toLowerCase() === word.toLowerCase()) {
                    return key;
                }
            });

            angular.extend(result.corrections, Object.keys(wordFoundInDict));

            return result.corrections.map((key) => ({key: key, value: key}));
        });
    };

    /**
     * Add word to user dictionary
     *
     * @param {String} word
     */
    this.addWordToUserDictionary = function(word) {
        dictionaries.addWordToUserDictionary(word, lang);
        dict.content[word] = dict.content[word] ? dict.content[word] + 1 : 1;
    };

    /**
     * Ignore word when spellchecking
     *
     * @param {String} word
     */
    this.ignoreWord = function(word) {
        getItemIgnored()[word] = 1;
    };

    /**
     * Test if given word is in ingored
     *
     * @param {String} word
     * @return {Boolean}
     */
    function isIgnored(word) {
        return !!getItemIgnored()[word];
    }

    /**
     * Get ignored collection for current item
     *
     * @return {Object}
     */
    function getItemIgnored() {
        var item = $location.search().item || '';

        ignored[item] = ignored[item] || {};
        return ignored[item];
    }

    // reset ignore list for an item if it was unlocked
    $rootScope.$on('item:unlock', (event, data) => {
        if (ignored.hasOwnProperty(data.item)) {
            ignored[data.item] = {};
        }
    });
}

SpellcheckMenuController.$inject = ['editor', 'preferencesService'];
function SpellcheckMenuController(editor, preferencesService) {
    this.isAuto = null;
    this.spellcheck = spellcheck;
    this.pushSettings = pushSettings;
    var PREFERENCES_KEY = 'spellchecker:status';
    var self = this;

    /**
     * Set the spell checker status
     */
    function setStatus(status) {
        var updates = {};

        updates[PREFERENCES_KEY] = {
            type: 'bool',
            enabled: status,
            default: true
        };

        preferencesService.update(updates, PREFERENCES_KEY);
    }

    /**
     * Get the spell checker status
     */
    function getStatus() {
        var status = true;

        return preferencesService.get(PREFERENCES_KEY).then((result) => {
            if (angular.isDefined(result)) {
                status = result.enabled;
            }
            return status;
        }, (error) => status);
    }

    /**
     * Force spell ckecking
     */
    function spellcheck() {
        editor.render(true);
    }

    /**
     * render the editor based on the spell check settings.
     */
    function render() {
        editor.setSettings({spellcheck: self.isAuto});
        editor.render();
    }

    /**
     * update the editor and preferences
     */
    function pushSettings() {
        render();
        setStatus(self.isAuto);
    }

    getStatus().then((status) => {
        self.isAuto = status;
        render();
    });
}

angular.module('superdesk.apps.spellcheck', ['superdesk.apps.dictionaries'])
    .service('spellcheck', SpellcheckService)
    .controller('SpellcheckMenu', SpellcheckMenuController);
