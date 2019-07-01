/**
 * dirPage - AngularJS module for paginating (almost) anything.
 *
 *
 * Credits
 * =======
 *
 * Daniel Tabuenca: https://groups.google.com/d/msg/angular/an9QpzqIYiM/r8v-3W1X5vcJ
 * for the idea on how to dynamically invoke the ng-repeat directive.
 *
 * I borrowed a couple of lines and a few attribute names from the AngularUI Bootstrap project:
 * https://github.com/angular-ui/bootstrap/blob/master/src/page/page.js
 *
 * Copyright 2014 Michael Bromley <michael@michaelbromley.co.uk>
 */

(function() {

    /**
     * Config
     */
    var moduleName = 'angularUtils.directives.dirPage';
    var DEFAULT_ID = '__default';

    /**
     * Module
     */
    angular.module(moduleName, [])
        .directive('dirPaginate', ['$compile', '$parse', 'pageService', dirPaginateDirective])
        .directive('dirPaginateNoCompile', noCompileDirective)
        .directive('dirPageControls', ['pageService', 'pageTemplate', dirPageControlsDirective])
        .filter('itemsPerPage', ['pageService', itemsPerPageFilter])
        .service('pageService', pageService)
        .provider('pageTemplate', pageTemplateProvider)
        .run(['$templateCache',dirPageControlsTemplateInstaller]);

    function dirPaginateDirective($compile, $parse, pageService) {

        return  {
            terminal: true,
            multiElement: true,
            priority: 100,
            compile: dirPageCompileFn
        };

        function dirPageCompileFn(tElement, tAttrs){

            var expression = tAttrs.dirPaginate;
            // regex taken directly from https://github.com/angular/angular.js/blob/v1.4.x/src/ng/directive/ngRepeat.js#L339
            var match = expression.match(/^\s*([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+track\s+by\s+([\s\S]+?))?\s*$/);

            var filterPattern = /\|\s*itemsPerPage\s*:\s*(.*\(\s*\w*\)|([^\)]*?(?=\s+as\s+))|[^\)]*)/;
            if (match[2].match(filterPattern) === null) {
                throw 'page directive: the \'itemsPerPage\' filter must be set.';
            }
            var itemsPerPageFilterRemoved = match[2].replace(filterPattern, '');
            var collectionGetter = $parse(itemsPerPageFilterRemoved);

            addNoCompileAttributes(tElement);

            // If any value is specified for pageId, we register the un-evaluated expression at this stage for the benefit of any
            // dir-page-controls directives that may be looking for this ID.
            var rawId = tAttrs.pageId || DEFAULT_ID;
            pageService.registerInstance(rawId);

            return function dirPageLinkFn(scope, element, attrs){

                // Now that we have access to the `scope` we can interpolate any expression given in the pageId attribute and
                // potentially register a new ID if it evaluates to a different value than the rawId.
                var pageId = $parse(attrs.pageId)(scope) || attrs.pageId || DEFAULT_ID;

                // (TODO: this seems sound, but I'm reverting as many bug reports followed it's introduction in 0.11.0.
                // Needs more investigation.)
                // In case rawId != pageId we deregister using rawId for the sake of general cleanliness
                // before registering using pageId
                // pageService.deregisterInstance(rawId);
                pageService.registerInstance(pageId);

                var repeatExpression = getRepeatExpression(expression, pageId);
                addNgRepeatToElement(element, attrs, repeatExpression);

                removeTemporaryAttributes(element);
                var compiled =  $compile(element);

                var currentPageGetter = makeCurrentPageGetterFn(scope, attrs, pageId);
                pageService.setCurrentPageParser(pageId, currentPageGetter, scope);

                if (typeof attrs.totalItems !== 'undefined') {
                    pageService.setAsyncModeTrue(pageId);
                    scope.$watch(function() {
                        return $parse(attrs.totalItems)(scope);
                    }, function (result) {
                        if (0 <= result) {
                            pageService.setCollectionLength(pageId, result);
                        }
                    });
                } else {
                    pageService.setAsyncModeFalse(pageId);
                    scope.$watchCollection(function() {
                        return collectionGetter(scope);
                    }, function(collection) {
                        if (collection) {
                            var collectionLength = (collection instanceof Array) ? collection.length : Object.keys(collection).length;
                            pageService.setCollectionLength(pageId, collectionLength);
                        }
                    });
                }

                // Delegate to the link function returned by the new compilation of the ng-repeat
                compiled(scope);

                // (TODO: Reverting this due to many bug reports in v 0.11.0. Needs investigation as the
                // principle is sound)
                // When the scope is destroyed, we make sure to remove the reference to it in pageService
                // so that it can be properly garbage collected
                // scope.$on('$destroy', function destroydirPage() {
                //     pageService.deregisterInstance(pageId);
                // });
            };
        }

        /**
         * If a page id has been specified, we need to check that it is present as the second argument passed to
         * the itemsPerPage filter. If it is not there, we add it and return the modified expression.
         *
         * @param expression
         * @param pageId
         * @returns {*}
         */
        function getRepeatExpression(expression, pageId) {
            var repeatExpression,
                idDefinedInFilter = !!expression.match(/(\|\s*itemsPerPage\s*:[^|]*:[^|]*)/);

            if (pageId !== DEFAULT_ID && !idDefinedInFilter) {
                repeatExpression = expression.replace(/(\|\s*itemsPerPage\s*:\s*[^|\s]*)/, "$1 : '" + pageId + "'");
            } else {
                repeatExpression = expression;
            }

            return repeatExpression;
        }

        /**
         * Adds the ng-repeat directive to the element. In the case of multi-element (-start, -end) it adds the
         * appropriate multi-element ng-repeat to the first and last element in the range.
         * @param element
         * @param attrs
         * @param repeatExpression
         */
        function addNgRepeatToElement(element, attrs, repeatExpression) {
            if (element[0].hasAttribute('dir-paginate-start') || element[0].hasAttribute('data-dir-paginate-start')) {
                // using multiElement mode (dir-paginate-start, dir-paginate-end)
                attrs.$set('ngRepeatStart', repeatExpression);
                element.eq(element.length - 1).attr('ng-repeat-end', true);
            } else {
                attrs.$set('ngRepeat', repeatExpression);
            }
        }

        /**
         * Adds the dir-paginate-no-compile directive to each element in the tElement range.
         * @param tElement
         */
        function addNoCompileAttributes(tElement) {
            angular.forEach(tElement, function(el) {
                if (el.nodeType === 1) {
                    angular.element(el).attr('dir-paginate-no-compile', true);
                }
            });
        }

        /**
         * Removes the variations on dir-paginate (data-, -start, -end) and the dir-paginate-no-compile directives.
         * @param element
         */
        function removeTemporaryAttributes(element) {
            angular.forEach(element, function(el) {
                if (el.nodeType === 1) {
                    angular.element(el).removeAttr('dir-paginate-no-compile');
                }
            });
            element.eq(0).removeAttr('dir-paginate-start').removeAttr('dir-paginate').removeAttr('data-dir-paginate-start').removeAttr('data-dir-paginate');
            element.eq(element.length - 1).removeAttr('dir-paginate-end').removeAttr('data-dir-paginate-end');
        }

        /**
         * Creates a getter function for the current-page attribute, using the expression provided or a default value if
         * no current-page expression was specified.
         *
         * @param scope
         * @param attrs
         * @param pageId
         * @returns {*}
         */
        function makeCurrentPageGetterFn(scope, attrs, pageId) {
            var currentPageGetter;
            if (attrs.currentPage) {
                currentPageGetter = $parse(attrs.currentPage);
            } else {
                // If the current-page attribute was not set, we'll make our own.
                // Replace any non-alphanumeric characters which might confuse
                // the $parse service and give unexpected results.
                // See https://github.com/michaelbromley/angularUtils/issues/233
                // Adding the '_' as a prefix resolves an issue where pageId might be have a digit as its first char
                // See https://github.com/michaelbromley/angularUtils/issues/400
                var defaultCurrentPage = '_' + (pageId + '__currentPage').replace(/\W/g, '_');
                scope[defaultCurrentPage] = 1;
                currentPageGetter = $parse(defaultCurrentPage);
            }
            return currentPageGetter;
        }
    }

    /**
     * This is a helper directive that allows correct compilation when in multi-element mode (ie dir-paginate-start, dir-paginate-end).
     * It is dynamically added to all elements in the dir-paginate compile function, and it prevents further compilation of
     * any inner directives. It is then removed in the link function, and all inner directives are then manually compiled.
     */
    function noCompileDirective() {
        return {
            priority: 5000,
            terminal: true
        };
    }

    function dirPageControlsTemplateInstaller($templateCache) {
        $templateCache.put('angularUtils.directives.dirPage.template', '<ul class="page" ng-if="1 < pages.length || !autoHide"><li ng-if="boundaryLinks" ng-class="{ disabled : page.current == 1 }"><a href="" ng-click="setCurrent(1)">&laquo;</a></li><li ng-if="directionLinks" ng-class="{ disabled : page.current == 1 }"><a href="" ng-click="setCurrent(page.current - 1)">&lsaquo;</a></li><li ng-repeat="pageNumber in pages track by tracker(pageNumber, $index)" ng-class="{ active : page.current == pageNumber, disabled : pageNumber == \'...\' || ( ! autoHide && pages.length === 1 ) }"><a href="" ng-click="setCurrent(pageNumber)">{{ pageNumber }}</a></li><li ng-if="directionLinks" ng-class="{ disabled : page.current == page.last }"><a href="" ng-click="setCurrent(page.current + 1)">&rsaquo;</a></li><li ng-if="boundaryLinks"  ng-class="{ disabled : page.current == page.last }"><a href="" ng-click="setCurrent(page.last)">&raquo;</a></li></ul>');
    }

    function dirPageControlsDirective(pageService, pageTemplate) {

        var numberRegex = /^\d+$/;

        var DDO = {
            restrict: 'AE',
            scope: {
                maxSize: '=?',
                onPageChange: '&?',
                pageId: '=?',
                autoHide: '=?'
            },
            link: dirPageControlsLinkFn
        };

        // We need to check the pageTemplate service to see whether a template path or
        // string has been specified, and add the `template` or `templateUrl` property to
        // the DDO as appropriate. The order of priority to decide which template to use is
        // (highest priority first):
        // 1. pageTemplate.getString()
        // 2. attrs.templateUrl
        // 3. pageTemplate.getPath()
        var templateString = pageTemplate.getString();
        if (templateString !== undefined) {
            DDO.template = templateString;
        } else {
            DDO.templateUrl = function(elem, attrs) {
                return attrs.templateUrl || pageTemplate.getPath();
            };
        }
        return DDO;

        function dirPageControlsLinkFn(scope, element, attrs) {

            // rawId is the un-interpolated value of the page-id attribute. This is only important when the corresponding dir-paginate directive has
            // not yet been linked (e.g. if it is inside an ng-if block), and in that case it prevents this controls directive from assuming that there is
            // no corresponding dir-paginate directive and wrongly throwing an exception.
            var rawId = attrs.pageId ||  DEFAULT_ID;
            var pageId = scope.pageId || attrs.pageId ||  DEFAULT_ID;

            if (!pageService.isRegistered(pageId) && !pageService.isRegistered(rawId)) {
                var idMessage = (pageId !== DEFAULT_ID) ? ' (id: ' + pageId + ') ' : ' ';
                if (window.console) {
                    console.warn('page directive: the page controls' + idMessage + 'cannot be used without the corresponding page directive, which was not found at link time.');
                }
            }

            if (!scope.maxSize) { scope.maxSize = 9; }
            scope.autoHide = scope.autoHide === undefined ? true : scope.autoHide;
            scope.directionLinks = angular.isDefined(attrs.directionLinks) ? scope.$parent.$eval(attrs.directionLinks) : true;
            scope.boundaryLinks = angular.isDefined(attrs.boundaryLinks) ? scope.$parent.$eval(attrs.boundaryLinks) : false;

            var pageRange = Math.max(scope.maxSize, 5);
            scope.pages = [];
            scope.page = {
                last: 1,
                current: 1
            };
            scope.range = {
                lower: 1,
                upper: 1,
                total: 1
            };

            scope.$watch('maxSize', function(val) {
                if (val) {
                    pageRange = Math.max(scope.maxSize, 5);
                    generatepage();
                }
            });

            scope.$watch(function() {
                if (pageService.isRegistered(pageId)) {
                    return (pageService.getCollectionLength(pageId) + 1) * pageService.getItemsPerPage(pageId);
                }
            }, function(length) {
                if (0 < length) {
                    generatepage();
                }
            });

            scope.$watch(function() {
                if (pageService.isRegistered(pageId)) {
                    return (pageService.getItemsPerPage(pageId));
                }
            }, function(current, previous) {
                if (current != previous && typeof previous !== 'undefined') {
                    goToPage(scope.page.current);
                }
            });

            scope.$watch(function() {
                if (pageService.isRegistered(pageId)) {
                    return pageService.getCurrentPage(pageId);
                }
            }, function(currentPage, previousPage) {
                if (currentPage != previousPage) {
                    goToPage(currentPage);
                }
            });

            scope.setCurrent = function(num) {
                if (pageService.isRegistered(pageId) && isValidPageNumber(num)) {
                    num = parseInt(num, 10);
                    pageService.setCurrentPage(pageId, num);
                }
            };

            /**
             * Custom "track by" function which allows for duplicate "..." entries on long lists,
             * yet fixes the problem of wrongly-highlighted links which happens when using
             * "track by $index" - see https://github.com/michaelbromley/angularUtils/issues/153
             * @param id
             * @param index
             * @returns {string}
             */
            scope.tracker = function(id, index) {
                return id + '_' + index;
            };

            function goToPage(num) {
                if (pageService.isRegistered(pageId) && isValidPageNumber(num)) {
                    var oldPageNumber = scope.page.current;

                    scope.pages = generatePagesArray(num, pageService.getCollectionLength(pageId), pageService.getItemsPerPage(pageId), pageRange);
                    scope.page.current = num;
                    updateRangeValues();

                    // if a callback has been set, then call it with the page number as the first argument
                    // and the previous page number as a second argument
                    if (scope.onPageChange) {
                        scope.onPageChange({
                            newPageNumber : num,
                            oldPageNumber : oldPageNumber
                        });
                    }
                }
            }

            function generatepage() {
                if (pageService.isRegistered(pageId)) {
                    var page = parseInt(pageService.getCurrentPage(pageId)) || 1;
                    scope.pages = generatePagesArray(page, pageService.getCollectionLength(pageId), pageService.getItemsPerPage(pageId), pageRange);
                    scope.page.current = page;
                    scope.page.last = scope.pages[scope.pages.length - 1];
                    if (scope.page.last < scope.page.current) {
                        scope.setCurrent(scope.page.last);
                    } else {
                        updateRangeValues();
                    }
                }
            }

            /**
             * This function updates the values (lower, upper, total) of the `scope.range` object, which can be used in the page
             * template to display the current page range, e.g. "showing 21 - 40 of 144 results";
             */
            function updateRangeValues() {
                if (pageService.isRegistered(pageId)) {
                    var currentPage = pageService.getCurrentPage(pageId),
                        itemsPerPage = pageService.getItemsPerPage(pageId),
                        totalItems = pageService.getCollectionLength(pageId);

                    scope.range.lower = (currentPage - 1) * itemsPerPage + 1;
                    scope.range.upper = Math.min(currentPage * itemsPerPage, totalItems);
                    scope.range.total = totalItems;
                }
            }
            function isValidPageNumber(num) {
                return (numberRegex.test(num) && (0 < num && num <= scope.page.last));
            }
        }

        /**
         * Generate an array of page numbers (or the '...' string) which is used in an ng-repeat to generate the
         * links used in page
         *
         * @param currentPage
         * @param rowsPerPage
         * @param pageRange
         * @param collectionLength
         * @returns {Array}
         */
        function generatePagesArray(currentPage, collectionLength, rowsPerPage, pageRange) {
            var pages = [];
            var totalPages = Math.ceil(collectionLength / rowsPerPage);
            var halfWay = Math.ceil(pageRange / 2);
            var position;

            if (currentPage <= halfWay) {
                position = 'start';
            } else if (totalPages - halfWay < currentPage) {
                position = 'end';
            } else {
                position = 'middle';
            }

            var ellipsesNeeded = pageRange < totalPages;
            var i = 1;
            while (i <= totalPages && i <= pageRange) {
                var pageNumber = calculatePageNumber(i, currentPage, pageRange, totalPages);

                var openingEllipsesNeeded = (i === 2 && (position === 'middle' || position === 'end'));
                var closingEllipsesNeeded = (i === pageRange - 1 && (position === 'middle' || position === 'start'));
                if (ellipsesNeeded && (openingEllipsesNeeded || closingEllipsesNeeded)) {
                    pages.push('...');
                } else {
                    pages.push(pageNumber);
                }
                i ++;
            }
            return pages;
        }

        /**
         * Given the position in the sequence of page links [i], figure out what page number corresponds to that position.
         *
         * @param i
         * @param currentPage
         * @param pageRange
         * @param totalPages
         * @returns {*}
         */
        function calculatePageNumber(i, currentPage, pageRange, totalPages) {
            var halfWay = Math.ceil(pageRange/2);
            if (i === pageRange) {
                return totalPages;
            } else if (i === 1) {
                return i;
            } else if (pageRange < totalPages) {
                if (totalPages - halfWay < currentPage) {
                    return totalPages - pageRange + i;
                } else if (halfWay < currentPage) {
                    return currentPage - halfWay + i;
                } else {
                    return i;
                }
            } else {
                return i;
            }
        }
    }

    /**
     * This filter slices the collection into pages based on the current page number and number of items per page.
     * @param pageService
     * @returns {Function}
     */
    function itemsPerPageFilter(pageService) {

        return function(collection, itemsPerPage, pageId) {
            if (typeof (pageId) === 'undefined') {
                pageId = DEFAULT_ID;
            }
            if (!pageService.isRegistered(pageId)) {
                throw 'page directive: the itemsPerPage id argument (id: ' + pageId + ') does not match a registered page-id.';
            }
            var end;
            var start;
            if (angular.isObject(collection)) {
                itemsPerPage = parseInt(itemsPerPage) || 9999999999;
                if (pageService.isAsyncMode(pageId)) {
                    start = 0;
                } else {
                    start = (pageService.getCurrentPage(pageId) - 1) * itemsPerPage;
                }
                end = start + itemsPerPage;
                pageService.setItemsPerPage(pageId, itemsPerPage);

                if (collection instanceof Array) {
                    // the array just needs to be sliced
                    return collection.slice(start, end);
                } else {
                    // in the case of an object, we need to get an array of keys, slice that, then map back to
                    // the original object.
                    var slicedObject = {};
                    angular.forEach(keys(collection).slice(start, end), function(key) {
                        slicedObject[key] = collection[key];
                    });
                    return slicedObject;
                }
            } else {
                return collection;
            }
        };
    }

    /**
     * Shim for the Object.keys() method which does not exist in IE < 9
     * @param obj
     * @returns {Array}
     */
    function keys(obj) {
        if (!Object.keys) {
            var objKeys = [];
            for (var i in obj) {
                if (obj.hasOwnProperty(i)) {
                    objKeys.push(i);
                }
            }
            return objKeys;
        } else {
            return Object.keys(obj);
        }
    }

    /**
     * This service allows the various parts of the module to communicate and stay in sync.
     */
    function pageService() {

        var instances = {};
        var lastRegisteredInstance;

        this.registerInstance = function(instanceId) {
            if (typeof instances[instanceId] === 'undefined') {
                instances[instanceId] = {
                    asyncMode: false
                };
                lastRegisteredInstance = instanceId;
            }
        };

        this.deregisterInstance = function(instanceId) {
            delete instances[instanceId];
        };

        this.isRegistered = function(instanceId) {
            return (typeof instances[instanceId] !== 'undefined');
        };

        this.getLastInstanceId = function() {
            return lastRegisteredInstance;
        };

        this.setCurrentPageParser = function(instanceId, val, scope) {
            instances[instanceId].currentPageParser = val;
            instances[instanceId].context = scope;
        };
        this.setCurrentPage = function(instanceId, val) {
            instances[instanceId].currentPageParser.assign(instances[instanceId].context, val);
        };
        this.getCurrentPage = function(instanceId) {
            var parser = instances[instanceId].currentPageParser;
            return parser ? parser(instances[instanceId].context) : 1;
        };

        this.setItemsPerPage = function(instanceId, val) {
            instances[instanceId].itemsPerPage = val;
        };
        this.getItemsPerPage = function(instanceId) {
            return instances[instanceId].itemsPerPage;
        };

        this.setCollectionLength = function(instanceId, val) {
            instances[instanceId].collectionLength = val;
        };
        this.getCollectionLength = function(instanceId) {
            return instances[instanceId].collectionLength;
        };

        this.setAsyncModeTrue = function(instanceId) {
            instances[instanceId].asyncMode = true;
        };

        this.setAsyncModeFalse = function(instanceId) {
            instances[instanceId].asyncMode = false;
        };

        this.isAsyncMode = function(instanceId) {
            return instances[instanceId].asyncMode;
        };
    }

    /**
     * This provider allows global configuration of the template path used by the dir-page-controls directive.
     */
    function pageTemplateProvider() {

        var templatePath = 'angularUtils.directives.dirPage.template';
        var templateString;

        /**
         * Set a templateUrl to be used by all instances of <dir-page-controls>
         * @param {String} path
         */
        this.setPath = function(path) {
            templatePath = path;
        };

        /**
         * Set a string of HTML to be used as a template by all instances
         * of <dir-page-controls>. If both a path *and* a string have been set,
         * the string takes precedence.
         * @param {String} str
         */
        this.setString = function(str) {
            templateString = str;
        };

        this.$get = function() {
            return {
                getPath: function() {
                    return templatePath;
                },
                getString: function() {
                    return templateString;
                }
            };
        };
    }
})();
