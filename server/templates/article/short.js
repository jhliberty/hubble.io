var moment = require('../../../lib/moment');

module.exports = function(html, templates, conf, bind, Map, content) {

  var map = Map();
  map['class']('title').to('title');
  map['class']('title').use('url').as('href');
  map['class']('authors').to('authors');
  map['class']('when').to('when');
  map['class']('description').to('description');
  map.where('href').is('/to-article').use('url').as('href');
  map.where('href').is('/rate').use('rate_url').as('href');

  return function(article, urlPrefix) {

    if (! urlPrefix) {
      urlPrefix = '';
    }

    var url = urlPrefix + '/guides/' + encodeURIComponent(article.name);

    var data = {
      title: article.meta.title,
      authors: templates('/author/anchor_strings.html').call(this, article.meta.authors),
      when: moment(article.github.created_at).fromNow(),
      description: article.meta.description,
      url: url,
      rate_url: url + '/like'
    };

    return bind(html, data, map);
  };
};