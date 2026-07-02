// Apps Script's V8 runtime has no `URL`/`URLSearchParams` (no browser DOM, no
// Node `url` module) -- this is a minimal hand-rolled replacement for the
// handful of things ScraperService needs: resolving relative hrefs against a
// base URL, and pulling out origin/pathname. Not a full URL spec
// implementation, just enough for scraping real-world company websites.

var UrlUtils = (function () {
  var ABSOLUTE_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\/]+/;
  var SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

  function normalize(url) {
    if (!ABSOLUTE_RE.test(url)) {
      var err = new Error("Invalid URL: " + url);
      throw err;
    }
    return url;
  }

  function getOrigin(absoluteUrl) {
    var match = String(absoluteUrl).match(ABSOLUTE_RE);
    if (!match) throw new Error("Invalid URL: " + absoluteUrl);
    return match[0];
  }

  function getPathname(absoluteUrl) {
    var match = String(absoluteUrl).match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\/]+(\/[^?#]*)?/);
    return (match && match[1]) || "/";
  }

  // Resolves a possibly-relative href against a base absolute URL.
  function resolve(href, base) {
    href = String(href).trim();
    if (SCHEME_RE.test(href)) return href; // already absolute (incl. mailto:, tel:)

    var origin = getOrigin(base);

    if (href.indexOf("//") === 0) {
      return origin.match(SCHEME_RE)[0] + href; // protocol-relative
    }
    if (href.indexOf("/") === 0) {
      return origin + href; // root-relative
    }
    if (href === "") return base;
    if (href.indexOf("#") === 0 || href.indexOf("?") === 0) {
      return base.split(/[?#]/)[0] + href;
    }

    var basePath = getPathname(base);
    var baseDir = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    var combined = (baseDir + href).split("/");
    var stack = [];
    for (var i = 0; i < combined.length; i++) {
      var part = combined[i];
      if (part === "." || part === "") continue;
      if (part === "..") { stack.pop(); continue; }
      stack.push(part);
    }
    return origin + "/" + stack.join("/");
  }

  return { normalize: normalize, getOrigin: getOrigin, getPathname: getPathname, resolve: resolve };
})();
