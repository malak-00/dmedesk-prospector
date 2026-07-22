# Chrome-Extension - Content Scripts

**Pages:** 11

---

## Content scripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/content_scripts#dynamic-declarative

**Contents:**
- Content scripts Stay organized with collections Save and categorize content based on your preferences.
- Understand content script capabilities
- Work in isolated worlds
- Inject scripts
  - Inject with static declarations
  - Inject with dynamic declarations
  - Inject programmatically
  - Exclude matches and globs
  - Run time
  - Specify frames

Content scripts are files that run in the context of web pages. Using the standard Document Object Model (DOM), they are able to read details of the web pages the browser visits, make changes to them, and pass information to their parent extension.

Content scripts can access the following extension APIs directly:

Content scripts are unable to access other APIs directly. But they can access them indirectly by exchanging messages with other parts of your extension.

You can also access other files in your extension from a content script, using APIs like fetch(). To do this, you need to declare them as web-accessible resources. Note that this also exposes the resources to any first-party or third-party scripts running on the same site.

Content scripts live in an isolated world, allowing a content script to make changes to its JavaScript environment without conflicting with the page or other extensions' content scripts.

An extension may run in a web page with code similar to the following example.

That extension could inject the following content script using one of the techniques outlined in the Inject scripts section.

With this change, both alerts appear in sequence when the button is clicked.

Content scripts can be declared statically, declared dynamically, or programmatically injected.

Use static content script declarations in manifest.json for scripts that should be automatically run on a well known set of pages.

Statically declared scripts are registered in the manifest under the "content_scripts" key. They can include JavaScript files, CSS files, or both. All auto-run content scripts must specify match patterns.

Dynamic content scripts are useful when the match patterns for content scripts are not well known or when content scripts shouldn't always be injected on known hosts.

Introduced in Chrome 96, dynamic declarations are similar to static declarations, but the content script object is registered with Chrome using methods in the chrome.scripting namespace rather than in manifest.json. The Scripting API also allows extension developers to:

Like static declarations, dynamic declarations can include JavaScript files, CSS files, or both.

Use programmatic injection for content scripts that need to run in response to events or on specific occasions.

To inject a content script programmatically, your extension needs host permissions for the page it's trying to inject scripts into. Host permissions can either be granted by requesting them as par

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
<html>
  <button id="mybutton">click me</button>
  <script>
    var greeting = "hello, ";
    var button = document.getElementById("mybutton");
    button.person_name = "Bob";
    button.addEventListener(
        "click", () => alert(greeting + button.person_name + "."), false);
  </script>
</html>
```

Example 2 (javascript):
```javascript
var greeting = "hola, ";
var button = document.getElementById("mybutton");
button.person_name = "Roberto";
button.addEventListener(
    "click", () => alert(greeting + button.person_name + "."), false);
```

Example 3 (unknown):
```unknown
{
 "name": "My extension",
 ...
 "content_scripts": [
   {
     "matches": ["https://*.nytimes.com/*"],
     "css": ["my-styles.css"],
     "js": ["content-script.js"]
   }
 ],
 ...
}
```

Example 4 (javascript):
```javascript
chrome.scripting
  .registerContentScripts([{
    id: "session-script",
    js: ["content.js"],
    persistAcrossSessions: false,
    matches: ["*://example.com/*"],
    runAt: "document_start",
  }])
  .then(() => console.log("registration complete"))
  .catch((err) => console.warn("unexpected error", err))
```

---

## Content scripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/content_scripts#matchAndGlob

**Contents:**
- Content scripts Stay organized with collections Save and categorize content based on your preferences.
- Understand content script capabilities
- Work in isolated worlds
- Inject scripts
  - Inject with static declarations
  - Inject with dynamic declarations
  - Inject programmatically
  - Exclude matches and globs
  - Run time
  - Specify frames

Content scripts are files that run in the context of web pages. Using the standard Document Object Model (DOM), they are able to read details of the web pages the browser visits, make changes to them, and pass information to their parent extension.

Content scripts can access the following extension APIs directly:

Content scripts are unable to access other APIs directly. But they can access them indirectly by exchanging messages with other parts of your extension.

You can also access other files in your extension from a content script, using APIs like fetch(). To do this, you need to declare them as web-accessible resources. Note that this also exposes the resources to any first-party or third-party scripts running on the same site.

Content scripts live in an isolated world, allowing a content script to make changes to its JavaScript environment without conflicting with the page or other extensions' content scripts.

An extension may run in a web page with code similar to the following example.

That extension could inject the following content script using one of the techniques outlined in the Inject scripts section.

With this change, both alerts appear in sequence when the button is clicked.

Content scripts can be declared statically, declared dynamically, or programmatically injected.

Use static content script declarations in manifest.json for scripts that should be automatically run on a well known set of pages.

Statically declared scripts are registered in the manifest under the "content_scripts" key. They can include JavaScript files, CSS files, or both. All auto-run content scripts must specify match patterns.

Dynamic content scripts are useful when the match patterns for content scripts are not well known or when content scripts shouldn't always be injected on known hosts.

Introduced in Chrome 96, dynamic declarations are similar to static declarations, but the content script object is registered with Chrome using methods in the chrome.scripting namespace rather than in manifest.json. The Scripting API also allows extension developers to:

Like static declarations, dynamic declarations can include JavaScript files, CSS files, or both.

Use programmatic injection for content scripts that need to run in response to events or on specific occasions.

To inject a content script programmatically, your extension needs host permissions for the page it's trying to inject scripts into. Host permissions can either be granted by requesting them as par

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
<html>
  <button id="mybutton">click me</button>
  <script>
    var greeting = "hello, ";
    var button = document.getElementById("mybutton");
    button.person_name = "Bob";
    button.addEventListener(
        "click", () => alert(greeting + button.person_name + "."), false);
  </script>
</html>
```

Example 2 (javascript):
```javascript
var greeting = "hola, ";
var button = document.getElementById("mybutton");
button.person_name = "Roberto";
button.addEventListener(
    "click", () => alert(greeting + button.person_name + "."), false);
```

Example 3 (unknown):
```unknown
{
 "name": "My extension",
 ...
 "content_scripts": [
   {
     "matches": ["https://*.nytimes.com/*"],
     "css": ["my-styles.css"],
     "js": ["content-script.js"]
   }
 ],
 ...
}
```

Example 4 (javascript):
```javascript
chrome.scripting
  .registerContentScripts([{
    id: "session-script",
    js: ["content.js"],
    persistAcrossSessions: false,
    matches: ["*://example.com/*"],
    runAt: "document_start",
  }])
  .then(() => console.log("registration complete"))
  .catch((err) => console.warn("unexpected error", err))
```

---

## Content scripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/content_scripts#static-declarative

**Contents:**
- Content scripts Stay organized with collections Save and categorize content based on your preferences.
- Understand content script capabilities
- Work in isolated worlds
- Inject scripts
  - Inject with static declarations
  - Inject with dynamic declarations
  - Inject programmatically
  - Exclude matches and globs
  - Run time
  - Specify frames

Content scripts are files that run in the context of web pages. Using the standard Document Object Model (DOM), they are able to read details of the web pages the browser visits, make changes to them, and pass information to their parent extension.

Content scripts can access the following extension APIs directly:

Content scripts are unable to access other APIs directly. But they can access them indirectly by exchanging messages with other parts of your extension.

You can also access other files in your extension from a content script, using APIs like fetch(). To do this, you need to declare them as web-accessible resources. Note that this also exposes the resources to any first-party or third-party scripts running on the same site.

Content scripts live in an isolated world, allowing a content script to make changes to its JavaScript environment without conflicting with the page or other extensions' content scripts.

An extension may run in a web page with code similar to the following example.

That extension could inject the following content script using one of the techniques outlined in the Inject scripts section.

With this change, both alerts appear in sequence when the button is clicked.

Content scripts can be declared statically, declared dynamically, or programmatically injected.

Use static content script declarations in manifest.json for scripts that should be automatically run on a well known set of pages.

Statically declared scripts are registered in the manifest under the "content_scripts" key. They can include JavaScript files, CSS files, or both. All auto-run content scripts must specify match patterns.

Dynamic content scripts are useful when the match patterns for content scripts are not well known or when content scripts shouldn't always be injected on known hosts.

Introduced in Chrome 96, dynamic declarations are similar to static declarations, but the content script object is registered with Chrome using methods in the chrome.scripting namespace rather than in manifest.json. The Scripting API also allows extension developers to:

Like static declarations, dynamic declarations can include JavaScript files, CSS files, or both.

Use programmatic injection for content scripts that need to run in response to events or on specific occasions.

To inject a content script programmatically, your extension needs host permissions for the page it's trying to inject scripts into. Host permissions can either be granted by requesting them as par

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
<html>
  <button id="mybutton">click me</button>
  <script>
    var greeting = "hello, ";
    var button = document.getElementById("mybutton");
    button.person_name = "Bob";
    button.addEventListener(
        "click", () => alert(greeting + button.person_name + "."), false);
  </script>
</html>
```

Example 2 (javascript):
```javascript
var greeting = "hola, ";
var button = document.getElementById("mybutton");
button.person_name = "Roberto";
button.addEventListener(
    "click", () => alert(greeting + button.person_name + "."), false);
```

Example 3 (unknown):
```unknown
{
 "name": "My extension",
 ...
 "content_scripts": [
   {
     "matches": ["https://*.nytimes.com/*"],
     "css": ["my-styles.css"],
     "js": ["content-script.js"]
   }
 ],
 ...
}
```

Example 4 (javascript):
```javascript
chrome.scripting
  .registerContentScripts([{
    id: "session-script",
    js: ["content.js"],
    persistAcrossSessions: false,
    matches: ["*://example.com/*"],
    runAt: "document_start",
  }])
  .then(() => console.log("registration complete"))
  .catch((err) => console.warn("unexpected error", err))
```

---

## Content scripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/content_scripts#functionality

**Contents:**
- Content scripts Stay organized with collections Save and categorize content based on your preferences.
- Understand content script capabilities
- Work in isolated worlds
- Inject scripts
  - Inject with static declarations
  - Inject with dynamic declarations
  - Inject programmatically
  - Exclude matches and globs
  - Run time
  - Specify frames

Content scripts are files that run in the context of web pages. Using the standard Document Object Model (DOM), they are able to read details of the web pages the browser visits, make changes to them, and pass information to their parent extension.

Content scripts can access the following extension APIs directly:

Content scripts are unable to access other APIs directly. But they can access them indirectly by exchanging messages with other parts of your extension.

You can also access other files in your extension from a content script, using APIs like fetch(). To do this, you need to declare them as web-accessible resources. Note that this also exposes the resources to any first-party or third-party scripts running on the same site.

Content scripts live in an isolated world, allowing a content script to make changes to its JavaScript environment without conflicting with the page or other extensions' content scripts.

An extension may run in a web page with code similar to the following example.

That extension could inject the following content script using one of the techniques outlined in the Inject scripts section.

With this change, both alerts appear in sequence when the button is clicked.

Content scripts can be declared statically, declared dynamically, or programmatically injected.

Use static content script declarations in manifest.json for scripts that should be automatically run on a well known set of pages.

Statically declared scripts are registered in the manifest under the "content_scripts" key. They can include JavaScript files, CSS files, or both. All auto-run content scripts must specify match patterns.

Dynamic content scripts are useful when the match patterns for content scripts are not well known or when content scripts shouldn't always be injected on known hosts.

Introduced in Chrome 96, dynamic declarations are similar to static declarations, but the content script object is registered with Chrome using methods in the chrome.scripting namespace rather than in manifest.json. The Scripting API also allows extension developers to:

Like static declarations, dynamic declarations can include JavaScript files, CSS files, or both.

Use programmatic injection for content scripts that need to run in response to events or on specific occasions.

To inject a content script programmatically, your extension needs host permissions for the page it's trying to inject scripts into. Host permissions can either be granted by requesting them as par

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
<html>
  <button id="mybutton">click me</button>
  <script>
    var greeting = "hello, ";
    var button = document.getElementById("mybutton");
    button.person_name = "Bob";
    button.addEventListener(
        "click", () => alert(greeting + button.person_name + "."), false);
  </script>
</html>
```

Example 2 (javascript):
```javascript
var greeting = "hola, ";
var button = document.getElementById("mybutton");
button.person_name = "Roberto";
button.addEventListener(
    "click", () => alert(greeting + button.person_name + "."), false);
```

Example 3 (unknown):
```unknown
{
 "name": "My extension",
 ...
 "content_scripts": [
   {
     "matches": ["https://*.nytimes.com/*"],
     "css": ["my-styles.css"],
     "js": ["content-script.js"]
   }
 ],
 ...
}
```

Example 4 (javascript):
```javascript
chrome.scripting
  .registerContentScripts([{
    id: "session-script",
    js: ["content.js"],
    persistAcrossSessions: false,
    matches: ["*://example.com/*"],
    runAt: "document_start",
  }])
  .then(() => console.log("registration complete"))
  .catch((err) => console.warn("unexpected error", err))
```

---

## Content scripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

**Contents:**
- Content scripts Stay organized with collections Save and categorize content based on your preferences.
- Understand content script capabilities
- Work in isolated worlds
- Inject scripts
  - Inject with static declarations
  - Inject with dynamic declarations
  - Inject programmatically
  - Exclude matches and globs
  - Run time
  - Specify frames

Content scripts are files that run in the context of web pages. Using the standard Document Object Model (DOM), they are able to read details of the web pages the browser visits, make changes to them, and pass information to their parent extension.

Content scripts can access the following extension APIs directly:

Content scripts are unable to access other APIs directly. But they can access them indirectly by exchanging messages with other parts of your extension.

You can also access other files in your extension from a content script, using APIs like fetch(). To do this, you need to declare them as web-accessible resources. Note that this also exposes the resources to any first-party or third-party scripts running on the same site.

Content scripts live in an isolated world, allowing a content script to make changes to its JavaScript environment without conflicting with the page or other extensions' content scripts.

An extension may run in a web page with code similar to the following example.

That extension could inject the following content script using one of the techniques outlined in the Inject scripts section.

With this change, both alerts appear in sequence when the button is clicked.

Content scripts can be declared statically, declared dynamically, or programmatically injected.

Use static content script declarations in manifest.json for scripts that should be automatically run on a well known set of pages.

Statically declared scripts are registered in the manifest under the "content_scripts" key. They can include JavaScript files, CSS files, or both. All auto-run content scripts must specify match patterns.

Dynamic content scripts are useful when the match patterns for content scripts are not well known or when content scripts shouldn't always be injected on known hosts.

Introduced in Chrome 96, dynamic declarations are similar to static declarations, but the content script object is registered with Chrome using methods in the chrome.scripting namespace rather than in manifest.json. The Scripting API also allows extension developers to:

Like static declarations, dynamic declarations can include JavaScript files, CSS files, or both.

Use programmatic injection for content scripts that need to run in response to events or on specific occasions.

To inject a content script programmatically, your extension needs host permissions for the page it's trying to inject scripts into. Host permissions can either be granted by requesting them as par

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
<html>
  <button id="mybutton">click me</button>
  <script>
    var greeting = "hello, ";
    var button = document.getElementById("mybutton");
    button.person_name = "Bob";
    button.addEventListener(
        "click", () => alert(greeting + button.person_name + "."), false);
  </script>
</html>
```

Example 2 (javascript):
```javascript
var greeting = "hola, ";
var button = document.getElementById("mybutton");
button.person_name = "Roberto";
button.addEventListener(
    "click", () => alert(greeting + button.person_name + "."), false);
```

Example 3 (unknown):
```unknown
{
 "name": "My extension",
 ...
 "content_scripts": [
   {
     "matches": ["https://*.nytimes.com/*"],
     "css": ["my-styles.css"],
     "js": ["content-script.js"]
   }
 ],
 ...
}
```

Example 4 (javascript):
```javascript
chrome.scripting
  .registerContentScripts([{
    id: "session-script",
    js: ["content.js"],
    persistAcrossSessions: false,
    matches: ["*://example.com/*"],
    runAt: "document_start",
  }])
  .then(() => console.log("registration complete"))
  .catch((err) => console.warn("unexpected error", err))
```

---

## Content scripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/content_scripts

**Contents:**
- Content scripts Stay organized with collections Save and categorize content based on your preferences.
- Understand content script capabilities
- Work in isolated worlds
- Inject scripts
  - Inject with static declarations
  - Inject with dynamic declarations
  - Inject programmatically
  - Exclude matches and globs
  - Run time
  - Specify frames

Content scripts are files that run in the context of web pages. Using the standard Document Object Model (DOM), they are able to read details of the web pages the browser visits, make changes to them, and pass information to their parent extension.

Content scripts can access the following extension APIs directly:

Content scripts are unable to access other APIs directly. But they can access them indirectly by exchanging messages with other parts of your extension.

You can also access other files in your extension from a content script, using APIs like fetch(). To do this, you need to declare them as web-accessible resources. Note that this also exposes the resources to any first-party or third-party scripts running on the same site.

Content scripts live in an isolated world, allowing a content script to make changes to its JavaScript environment without conflicting with the page or other extensions' content scripts.

An extension may run in a web page with code similar to the following example.

That extension could inject the following content script using one of the techniques outlined in the Inject scripts section.

With this change, both alerts appear in sequence when the button is clicked.

Content scripts can be declared statically, declared dynamically, or programmatically injected.

Use static content script declarations in manifest.json for scripts that should be automatically run on a well known set of pages.

Statically declared scripts are registered in the manifest under the "content_scripts" key. They can include JavaScript files, CSS files, or both. All auto-run content scripts must specify match patterns.

Dynamic content scripts are useful when the match patterns for content scripts are not well known or when content scripts shouldn't always be injected on known hosts.

Introduced in Chrome 96, dynamic declarations are similar to static declarations, but the content script object is registered with Chrome using methods in the chrome.scripting namespace rather than in manifest.json. The Scripting API also allows extension developers to:

Like static declarations, dynamic declarations can include JavaScript files, CSS files, or both.

Use programmatic injection for content scripts that need to run in response to events or on specific occasions.

To inject a content script programmatically, your extension needs host permissions for the page it's trying to inject scripts into. Host permissions can either be granted by requesting them as par

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
<html>
  <button id="mybutton">click me</button>
  <script>
    var greeting = "hello, ";
    var button = document.getElementById("mybutton");
    button.person_name = "Bob";
    button.addEventListener(
        "click", () => alert(greeting + button.person_name + "."), false);
  </script>
</html>
```

Example 2 (javascript):
```javascript
var greeting = "hola, ";
var button = document.getElementById("mybutton");
button.person_name = "Roberto";
button.addEventListener(
    "click", () => alert(greeting + button.person_name + "."), false);
```

Example 3 (unknown):
```unknown
{
 "name": "My extension",
 ...
 "content_scripts": [
   {
     "matches": ["https://*.nytimes.com/*"],
     "css": ["my-styles.css"],
     "js": ["content-script.js"]
   }
 ],
 ...
}
```

Example 4 (javascript):
```javascript
chrome.scripting
  .registerContentScripts([{
    id: "session-script",
    js: ["content.js"],
    persistAcrossSessions: false,
    matches: ["*://example.com/*"],
    runAt: "document_start",
  }])
  .then(() => console.log("registration complete"))
  .catch((err) => console.warn("unexpected error", err))
```

---

## Match patterns Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns

**Contents:**
- Match patterns Stay organized with collections Save and categorize content based on your preferences.
- Special cases
- Example patterns

A match pattern is a URL with the following structure, used to specify a group of URLs:

scheme: Must be one of the following, separated from the rest of the pattern using a colon followed by a double slash (://):

For information on injecting content scripts into unsupported schemes, such as about: and data:, see Injecting in related frames.

host: A hostname (www.example.com). A * before the hostname to match subdomains (*.example.com), or just a wildcard *. - If you use a wildcard in the host pattern, it must be the first or only character, and it must be followed by a period (.) or forward slash (/).

path: A URL path (/example). For host permissions, the path is required but ignored. The wildcard (/*) should be used by convention.

Extensions use match patterns in a variety of use cases, including the following:

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2012-09-18 UTC.

**Examples:**

Example 1 (unknown):
```unknown
<scheme>://<host>/<path>
```

---

## Content scripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/content_scripts#injecting-in-related-frames

**Contents:**
- Content scripts Stay organized with collections Save and categorize content based on your preferences.
- Understand content script capabilities
- Work in isolated worlds
- Inject scripts
  - Inject with static declarations
  - Inject with dynamic declarations
  - Inject programmatically
  - Exclude matches and globs
  - Run time
  - Specify frames

Content scripts are files that run in the context of web pages. Using the standard Document Object Model (DOM), they are able to read details of the web pages the browser visits, make changes to them, and pass information to their parent extension.

Content scripts can access the following extension APIs directly:

Content scripts are unable to access other APIs directly. But they can access them indirectly by exchanging messages with other parts of your extension.

You can also access other files in your extension from a content script, using APIs like fetch(). To do this, you need to declare them as web-accessible resources. Note that this also exposes the resources to any first-party or third-party scripts running on the same site.

Content scripts live in an isolated world, allowing a content script to make changes to its JavaScript environment without conflicting with the page or other extensions' content scripts.

An extension may run in a web page with code similar to the following example.

That extension could inject the following content script using one of the techniques outlined in the Inject scripts section.

With this change, both alerts appear in sequence when the button is clicked.

Content scripts can be declared statically, declared dynamically, or programmatically injected.

Use static content script declarations in manifest.json for scripts that should be automatically run on a well known set of pages.

Statically declared scripts are registered in the manifest under the "content_scripts" key. They can include JavaScript files, CSS files, or both. All auto-run content scripts must specify match patterns.

Dynamic content scripts are useful when the match patterns for content scripts are not well known or when content scripts shouldn't always be injected on known hosts.

Introduced in Chrome 96, dynamic declarations are similar to static declarations, but the content script object is registered with Chrome using methods in the chrome.scripting namespace rather than in manifest.json. The Scripting API also allows extension developers to:

Like static declarations, dynamic declarations can include JavaScript files, CSS files, or both.

Use programmatic injection for content scripts that need to run in response to events or on specific occasions.

To inject a content script programmatically, your extension needs host permissions for the page it's trying to inject scripts into. Host permissions can either be granted by requesting them as par

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
<html>
  <button id="mybutton">click me</button>
  <script>
    var greeting = "hello, ";
    var button = document.getElementById("mybutton");
    button.person_name = "Bob";
    button.addEventListener(
        "click", () => alert(greeting + button.person_name + "."), false);
  </script>
</html>
```

Example 2 (javascript):
```javascript
var greeting = "hola, ";
var button = document.getElementById("mybutton");
button.person_name = "Roberto";
button.addEventListener(
    "click", () => alert(greeting + button.person_name + "."), false);
```

Example 3 (unknown):
```unknown
{
 "name": "My extension",
 ...
 "content_scripts": [
   {
     "matches": ["https://*.nytimes.com/*"],
     "css": ["my-styles.css"],
     "js": ["content-script.js"]
   }
 ],
 ...
}
```

Example 4 (javascript):
```javascript
chrome.scripting
  .registerContentScripts([{
    id: "session-script",
    js: ["content.js"],
    persistAcrossSessions: false,
    matches: ["*://example.com/*"],
    runAt: "document_start",
  }])
  .then(() => console.log("registration complete"))
  .catch((err) => console.warn("unexpected error", err))
```

---

## Content scripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/content_scripts#programmatic

**Contents:**
- Content scripts Stay organized with collections Save and categorize content based on your preferences.
- Understand content script capabilities
- Work in isolated worlds
- Inject scripts
  - Inject with static declarations
  - Inject with dynamic declarations
  - Inject programmatically
  - Exclude matches and globs
  - Run time
  - Specify frames

Content scripts are files that run in the context of web pages. Using the standard Document Object Model (DOM), they are able to read details of the web pages the browser visits, make changes to them, and pass information to their parent extension.

Content scripts can access the following extension APIs directly:

Content scripts are unable to access other APIs directly. But they can access them indirectly by exchanging messages with other parts of your extension.

You can also access other files in your extension from a content script, using APIs like fetch(). To do this, you need to declare them as web-accessible resources. Note that this also exposes the resources to any first-party or third-party scripts running on the same site.

Content scripts live in an isolated world, allowing a content script to make changes to its JavaScript environment without conflicting with the page or other extensions' content scripts.

An extension may run in a web page with code similar to the following example.

That extension could inject the following content script using one of the techniques outlined in the Inject scripts section.

With this change, both alerts appear in sequence when the button is clicked.

Content scripts can be declared statically, declared dynamically, or programmatically injected.

Use static content script declarations in manifest.json for scripts that should be automatically run on a well known set of pages.

Statically declared scripts are registered in the manifest under the "content_scripts" key. They can include JavaScript files, CSS files, or both. All auto-run content scripts must specify match patterns.

Dynamic content scripts are useful when the match patterns for content scripts are not well known or when content scripts shouldn't always be injected on known hosts.

Introduced in Chrome 96, dynamic declarations are similar to static declarations, but the content script object is registered with Chrome using methods in the chrome.scripting namespace rather than in manifest.json. The Scripting API also allows extension developers to:

Like static declarations, dynamic declarations can include JavaScript files, CSS files, or both.

Use programmatic injection for content scripts that need to run in response to events or on specific occasions.

To inject a content script programmatically, your extension needs host permissions for the page it's trying to inject scripts into. Host permissions can either be granted by requesting them as par

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
<html>
  <button id="mybutton">click me</button>
  <script>
    var greeting = "hello, ";
    var button = document.getElementById("mybutton");
    button.person_name = "Bob";
    button.addEventListener(
        "click", () => alert(greeting + button.person_name + "."), false);
  </script>
</html>
```

Example 2 (javascript):
```javascript
var greeting = "hola, ";
var button = document.getElementById("mybutton");
button.person_name = "Roberto";
button.addEventListener(
    "click", () => alert(greeting + button.person_name + "."), false);
```

Example 3 (unknown):
```unknown
{
 "name": "My extension",
 ...
 "content_scripts": [
   {
     "matches": ["https://*.nytimes.com/*"],
     "css": ["my-styles.css"],
     "js": ["content-script.js"]
   }
 ],
 ...
}
```

Example 4 (javascript):
```javascript
chrome.scripting
  .registerContentScripts([{
    id: "session-script",
    js: ["content.js"],
    persistAcrossSessions: false,
    matches: ["*://example.com/*"],
    runAt: "document_start",
  }])
  .then(() => console.log("registration complete"))
  .catch((err) => console.warn("unexpected error", err))
```

---

## Content scripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/content_scripts#isolated_world

**Contents:**
- Content scripts Stay organized with collections Save and categorize content based on your preferences.
- Understand content script capabilities
- Work in isolated worlds
- Inject scripts
  - Inject with static declarations
  - Inject with dynamic declarations
  - Inject programmatically
  - Exclude matches and globs
  - Run time
  - Specify frames

Content scripts are files that run in the context of web pages. Using the standard Document Object Model (DOM), they are able to read details of the web pages the browser visits, make changes to them, and pass information to their parent extension.

Content scripts can access the following extension APIs directly:

Content scripts are unable to access other APIs directly. But they can access them indirectly by exchanging messages with other parts of your extension.

You can also access other files in your extension from a content script, using APIs like fetch(). To do this, you need to declare them as web-accessible resources. Note that this also exposes the resources to any first-party or third-party scripts running on the same site.

Content scripts live in an isolated world, allowing a content script to make changes to its JavaScript environment without conflicting with the page or other extensions' content scripts.

An extension may run in a web page with code similar to the following example.

That extension could inject the following content script using one of the techniques outlined in the Inject scripts section.

With this change, both alerts appear in sequence when the button is clicked.

Content scripts can be declared statically, declared dynamically, or programmatically injected.

Use static content script declarations in manifest.json for scripts that should be automatically run on a well known set of pages.

Statically declared scripts are registered in the manifest under the "content_scripts" key. They can include JavaScript files, CSS files, or both. All auto-run content scripts must specify match patterns.

Dynamic content scripts are useful when the match patterns for content scripts are not well known or when content scripts shouldn't always be injected on known hosts.

Introduced in Chrome 96, dynamic declarations are similar to static declarations, but the content script object is registered with Chrome using methods in the chrome.scripting namespace rather than in manifest.json. The Scripting API also allows extension developers to:

Like static declarations, dynamic declarations can include JavaScript files, CSS files, or both.

Use programmatic injection for content scripts that need to run in response to events or on specific occasions.

To inject a content script programmatically, your extension needs host permissions for the page it's trying to inject scripts into. Host permissions can either be granted by requesting them as par

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
<html>
  <button id="mybutton">click me</button>
  <script>
    var greeting = "hello, ";
    var button = document.getElementById("mybutton");
    button.person_name = "Bob";
    button.addEventListener(
        "click", () => alert(greeting + button.person_name + "."), false);
  </script>
</html>
```

Example 2 (javascript):
```javascript
var greeting = "hola, ";
var button = document.getElementById("mybutton");
button.person_name = "Roberto";
button.addEventListener(
    "click", () => alert(greeting + button.person_name + "."), false);
```

Example 3 (unknown):
```unknown
{
 "name": "My extension",
 ...
 "content_scripts": [
   {
     "matches": ["https://*.nytimes.com/*"],
     "css": ["my-styles.css"],
     "js": ["content-script.js"]
   }
 ],
 ...
}
```

Example 4 (javascript):
```javascript
chrome.scripting
  .registerContentScripts([{
    id: "session-script",
    js: ["content.js"],
    persistAcrossSessions: false,
    matches: ["*://example.com/*"],
    runAt: "document_start",
  }])
  .then(() => console.log("registration complete"))
  .catch((err) => console.warn("unexpected error", err))
```

---

## chrome.dom Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/dom

**Contents:**
- chrome.dom Stay organized with collections Save and categorize content based on your preferences.
- Description
- Availability
- Methods
  - openOrClosedShadowRoot()
    - Parameters
    - Returns

Description Use the chrome.dom API to access special DOM APIs for Extensions

Use the chrome.dom API to access special DOM APIs for Extensions

Availability Chrome 88+

Methods openOrClosedShadowRoot() chrome.dom.openOrClosedShadowRoot( element: HTMLElement,): object Gets the open shadow root or the closed shadow root hosted by the specified element. If the element doesn't attach the shadow root, it will return null. Parameters element HTMLElement Returns object See https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot

Gets the open shadow root or the closed shadow root hosted by the specified element. If the element doesn't attach the shadow root, it will return null.

See https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-08-11 UTC.

---
