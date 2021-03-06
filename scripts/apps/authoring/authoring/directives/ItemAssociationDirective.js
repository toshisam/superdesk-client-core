ItemAssociationDirective.$inject = ['superdesk', 'renditions', 'api', '$q', 'config'];
export function ItemAssociationDirective(superdesk, renditions, api, $q, config) {
    return {
        scope: {
            rel: '=',
            item: '=',
            editable: '=',
            allowVideo: '@',
            onchange: '&'
        },
        templateUrl: 'scripts/apps/authoring/views/item-association.html',
        link: function(scope, elem) {
            var MEDIA_TYPES = ['application/superdesk.item.picture', 'application/superdesk.item.graphic'];

            if (scope.allowVideo === 'true') {
                MEDIA_TYPES.push('application/superdesk.item.video');
            }
            /**
             * Get superdesk item from event
             *
             * @param {Event} event
             * @param {string} dataType
             * @return {Object}
             */
            function getItem(event, dataType) {
                return angular.fromJson(event.originalEvent.dataTransfer.getData(dataType));
            }

            // it should prevent default as long as this is valid image
            elem.on('dragover', (event) => {
                if (MEDIA_TYPES.indexOf(event.originalEvent.dataTransfer.types[0]) > -1) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            });

            // update item associations on drop
            elem.on('drop dragdrop', (event) => {
                event.preventDefault();
                event.stopPropagation();
                var item = getItem(event, event.originalEvent.dataTransfer.types[0]);
                // ingest picture if it comes from an external source (create renditions)

                if (scope.isEditable()) {
                    scope.loading = true;
                    renditions.ingest(item)
                    .then(scope.edit)
                    .finally(() => {
                        scope.loading = false;
                    });
                } else {
                    scope.$apply(() => {
                        updateItemAssociation(item);
                    });
                }
            });

            function updateItemAssociation(updated) {
                var data = {};

                data[scope.rel] = updated;
                scope.item.associations = angular.extend({}, scope.item.associations, data);
                scope.onchange({item: scope.item, data: data});
            }

            // init associated item for preview
            scope.$watch('item.associations[rel]', (related) => {
                scope.related = related;
            });

            renditions.get();

            scope.edit = function(item) {
                if (item.renditions && item.renditions.original && scope.isImage(item.renditions.original)) {
                    scope.loading = true;
                    return renditions.crop(item)
                    .then(updateItemAssociation)
                    .finally(() => {
                        scope.loading = false;
                    });
                }

                updateItemAssociation(item);
            };

            scope.isVideo = function(rendition) {
                if (_.startsWith(rendition.mimetype, 'video')) {
                    return true;
                }

                return _.some(['.mp4', '.webm', '.ogv', '.ogg'], (ext) => _.endsWith(rendition.href, ext));
            };

            scope.isImage = function(rendition) {
                return _.startsWith(rendition.mimetype, 'image');
            };

            scope.isEditable = function() {
                return !(config.features && 'editFeaturedImage' in config.features
                    && !config.features.editFeaturedImage);
            };

            scope.remove = function(item) {
                updateItemAssociation(null);
            };

            scope.upload = function() {
                if (scope.editable) {
                    superdesk.intent('upload', 'media', {uniqueUpload: true}).then((images) => {
                        // open the view to edit the PoI and the cropping areas
                        if (images) {
                            scope.$applyAsync(() => {
                                scope.edit(images[0]);
                            });
                        }
                    });
                }
            };
        }
    };
}
