/*
 *
 * content.js
 * merges the content from github into the html templates 
 * and creates a repos for it in memory if one does not exist.
 *
 */

var fs = require('fs'),
    async = require('async'),
    zlib = require('zlib'),
    tar = require('tar'),
    marked = require('marked'),
    request = require('request'),
    Plates = require('plates'),
    difficulty = require('./difficulty');

var dir = __dirname + '/tmp';

var Content = module.exports = function(conf, callback) {

  var that = this;
  conf = conf || {};

  this.repos = {
    'repository-index': { 
      composed: ''
    }
  };

  this.apihost = conf.apihost || 'https://api.github.com';
  this.orgname = conf.orgname || 'hubbleio';

  this.assets = {};
  this.categories = {};
  this.contributors = {};
  this.tags = {};
  this.difficulties = {};
};

Content.prototype.getArticle = function(name) {
  return this.repos[name].composed;
};

Content.prototype.getIndex = function() {
  return this.repos['repository-index'].composed;
};

//
// function compose()
//
// compose everything once when we start the server.
//
Content.prototype.compose = function (assets, repos) {

  var that = this;

  //
  // Compose for all items in the repos.
  //
  Object.keys(this.repos).forEach(function (name) {
    var repo = that.repos[name];
    assets['article.html'].compose(repo, that.categories);
  });

  //
  // if there are any updates, refresh the index.
  //
  assets['index.html'].compose(this.repos, this.contributors, this.tags, this.categories);
};


// function downloadReposGithubInfo(callback)
// @option callback {Function} what do once all done.
//
Content.prototype.downloadReposGithubInfo = function (callback) {

  var that = this;
  var url = this.apihost + '/orgs/' + this.orgname + '/repos';

  console.log('[hubble] Putting hubble in orbit around `' + url + '`.');

  request(url, function (err, res, body) {
    if (err) {
      return callback(err);
    }
    
    var cfg = JSON.parse(body);

    cfg.forEach(function(repo) {
      if (! that.repos[repo.name]) {
        that.repos[repo.name] = {};
      }
      that.repos[repo.name].github = repo;
    });

    callback();

  });
}

//
// function downloadAll(callback)
// @option callback {Function} what do once all done.
//
Content.prototype.downloadAll = function (callback) {

  var that = this;

  this.downloadReposGithubInfo(function(err) {
    if (err) { return callback(err); }

    console.log('[hubble] downloaded github info. I\'m about to scan %d repos.', Object.keys(that.repos).length);

    async.forEach(Object.keys(that.repos), function(repoName, next) {
      that.download(repoName, next);
    }, callback);

  });

};

//
// function download(repo, callback)
// @param repo {String} the name of the repo to get the zipball from
// @param callback {Function} what do once all done.
//
// grabbing the entire zipball will allow us to pull down images and other
// stuff that we might want to allow the article to include when served.
//
Content.prototype.download = function (repo, callback) {

  var that = this;

  var url = 'https://github.com/' + this.orgname + '/' + repo + '/tarball/master';
  var queue = [];

  console.log('[hubble] Attempting to download `' + url + '`.');

  function getfiles() {

    request(url)
      .pipe(zlib.Gunzip())
      .pipe(tar.Extract({ path: dir + '/' + repo }))
      .on('entry', function(entry) {
        //
        // tell the op that we've found a file and that we are unpacking it.
        // we dont care about directories or other assets because everything
        // is hosted on github.
        //
        if (entry.type === 'File') {
          console.log('[hubble] Unpacking `' + entry.path + '`.');
        }
      }).on('end', callback);
  }

  fs.stat(dir, function (err, d) {
    if (err) { return callback(err); }
    if (d && d.isDirectory()) {
      return getfiles();
    }

    fs.mkdir(dir, function (err) {
      if (err && err.code !== 'EEXIST') {
        return callback(err);
      }
      
      getfiles();
    });
  });
};


//
// function loadRepos(callback)
// @param callback {Function} what do when done Signature: (err).
//
// get the configuration from the directory.
//
Content.prototype.loadRepos = function (callback) {
  var that = this;

  //
  // Since a repo may have multiple versions downloaded,
  // this function checks to see which one was updated the latest,
  // which would mean it's the latest version.
  //
  function determineOldestRepoVersion (repoPath, done) {
    var latestVersion;

    fs.readdir(repoPath, function(err, repoFiles) {
      if (err) { return done(err); }

      async.forEach(repoFiles, function(version, next) {
        var versionPath = repoPath + '/' + version;
        fs.stat(versionPath, function(err, stat) {
          if (err) { return next(err); }
          if (! latestVersion || latestVersion.mtime < stat.mtime) {
            latestVersion = { mtime: stat.mtime, path: versionPath };
          }
          next();
        });
      }, function(err) {
        if (err) { return done(err); }
        done(null, latestVersion && latestVersion.path);
      });
    });
  }

  //
  // loadRepo actually loads the repo markup and metadata into memory
  //
  function loadRepo (repoName, done) {
    //that.repos[repoName] = {};
    var repoPath = dir + '/' + repoName;
    determineOldestRepoVersion(repoPath, function(err, latestVersionPath) {
      if (err) { return next(err); }
      if (! latestVersionPath) { return done(); }

      fs.readdir(latestVersionPath, function(err, repoFiles) {
        if (err) { return next(err); }

        //
        // iterate over all of the files that were found in the
        // archive and then pull their contents into the repos.
        //

        async.forEach(repoFiles, function (path, next) {
          if (~path.indexOf('article.md')) {
            that.getMarkup(repoName, latestVersionPath + '/' + path, next);
          }
          else if (~path.indexOf('article.json')) {
            that.getMETA(repoName, latestVersionPath+ '/' + path, next);
          } else {
            next();
          }
        }, done);
      });
    });
  }

  this.downloadReposGithubInfo(function(err) {
    if (err) { return callback(err); }
    
    fs.readdir(dir, function(err, files) {
      if (err) { return callback(err); }
      async.forEach(files, loadRepo, callback);
    });

  });
}

//
// function getMETA(repo, filename, next)
// @param repo {String} the name of the repo to get the zipball from
// @param filename {String} the name of the file that has been downloaded and extracted.
// @param next {Function} what do when done.
//
// get the configuration from the directory.
//
Content.prototype.getMETA = function (repo, filename, next) {
  var that = this;
  fs.readFile(filename, 'utf8', function (err, data) {
    var meta;

    if (err) {
      return next(err);
    }

    if (! that.repos[repo]) { that.repos[repo] = {}; }

    console.log('[hubble] Caching meta data from `' + filename + '`.');
    that.repos[repo].files = that.repos[repo].files || {};
  
    if (!that.repos[repo].files[filename]) {
      that.repos[repo].files[filename] = {};
    }

    meta = JSON.parse(data);
    that.repos[repo].meta = meta;    
    that.repos[repo].files[filename].meta = meta;

    next();
  }); 

};

//
// function getMarkup(name, filename, next)
// @param repo {String} the name of the repo to get the zipball from
// @param filename {String} the name of the file that has been downloaded and extracted.
// @param next {Function} what do when done.
//
// get the content from the directory.
//
Content.prototype.getMarkup = function (repoName, filename, next) {
  var repo ;
  var that = this;

  if (! this.repos[repoName]) { this.repos[repoName] = {}; }

  repo = this.repos[repoName];
  fs.readFile(filename, 'utf8', function (err, data) {
    if (err) {
      return next(err);
    }

    console.log('[hubble] Transforming markdown from `' + filename + '`.');
    repo.files = repo.files || {};
  
    if (!repo.files[filename]) {
      repo.files[filename] = {};
    }
    
    repo.files[filename].markup = marked(data);
    repo.markup = data;
    next();
  });
};


//
// function reduceCategories()
//
// Aggregate on meta categories
//
Content.prototype.reduceCategories = function () {
  var repoNames = Object.keys(this.repos),
      that = this;
  
  repoNames.forEach(function(repoName) {
    var repo = that.repos[repoName];

    if (repo.meta && repo.meta.categories) {
      if (! Array.isArray(repo.meta.categories)) { repo.meta.categories = [repo.meta.categories]; }
      
      repo.meta.categories.forEach(function(categoryChain) {
        if (! Array.isArray(categoryChain)) { categoryChain = [categoryChain]; }
        var currentCategoryChildren = that.categories;
        var categoryId = [];
        
        categoryChain.forEach(function(category) {
          categoryId.push(category);
          if (! currentCategoryChildren[category]) { currentCategoryChildren[category] =
            {
              id: categoryId.join('-'),
              name: category,
              children: {}
            };
          }
          currentCategoryChildren = currentCategoryChildren[category].children;
        });
      });
    }
  });
};


//
// function reduceContributors()
//
// Aggregate on meta authors
//
Content.prototype.reduceContributors = function () {
  var repoNames = Object.keys(this.repos),
      that = this;
  
  this.contributors = repoNames.reduce(function(contributors, repoName) {
    var repo = that.repos[repoName];

    if (repo.meta && repo.meta.authors) {
      repo.meta.authors.forEach(function(contributor) {
        if (! contributors[contributor.name]) {
          contributors[contributor.name] = contributor;
          contributor.repos = [];
        }
        contributor.repos.push(repo);
      });
    }
    return contributors;
  }, {});
};

//
// function reduceTags()
//
// Aggregate on meta tags
//
Content.prototype.reduceTags = function () {
  var repoNames = Object.keys(this.repos),
      that = this;
  
  this.tags = repoNames.reduce(function(tags, repoName) {
    var repo = that.repos[repoName];

    if (repo.meta && repo.meta.tags) {
      repo.meta.tags.forEach(function(tag) {
        if (! tags[tag]) { tags[tag] = []; }
        tags[tag].push(repo);
      });
    }
    return tags;
  }, {});
};

//
// function reduceDifficulties()
//
// Aggregate on meta.difficulty
//
Content.prototype.reduceDifficulties = function () {
    var repoNames = Object.keys(this.repos),
      that = this;
  
  repoNames.map(function(repoName) {
    var repo = that.repos[repoName],
        difficultyLabel;

    if (repo.meta && repo.meta.difficulty) {
      repo.meta.difficultyLabel = difficultyLabel = difficulty(repo.meta.difficulty);
      if (! that.difficulties[difficultyLabel]) { that.difficulties[difficultyLabel] = []; }
      that.difficulties[difficultyLabel].push(repo);
    }
  });

}

//
// function aggregate()
//
// Aggregate on meta tags and categories
//
Content.prototype.aggregate = function () {
  this.reduceContributors();
  this.reduceTags();
  this.reduceCategories();
  this.reduceDifficulties();
};

