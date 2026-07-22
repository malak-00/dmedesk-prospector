# Chrome-Extension - Manifest

**Pages:** 34

---

## Manifest - Web Accessible Resources Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources

**Contents:**
- Manifest - Web Accessible Resources Stay organized with collections Save and categorize content based on your preferences.
- Manifest declaration
- Navigability of resources
- Example

Web-accessible resources are files inside an extension that can be accessed by web pages or other extensions. Extensions typically use this feature to expose images or other assets that need to be loaded in web pages, but any asset included in an extension's bundle can be made web accessible.

By default no resources are web accessible, as this allows a malicious website to fingerprint extensions that a user has installed or exploit vulnerabilities (for example XSS bugs) in installed extensions. Only pages or scripts loaded from an extension's origin can access that extension's resources.

Use the web_accessible_resources manifest property to declare which resources are exposed and to what origins. This property is an array of objects that declares resource access rules. Each object maps an array of extension resources to an array of URLs and/or extension IDs that can access those resources.

Each object in the array contains these elements:

Each element must include a "resources" element and either a "matches" or "extension_ids" element. This establishes a mapping that exposes the specified resources to either web pages matching the pattern or to extensions with matching IDs. The "use_dynamic_url" element is optional.

Resources are available in a webpage via the URL chrome-extension://[PACKAGE ID]/[PATH], which can be generated with the runtime.getURL() method. The resources are served with appropriate CORS headers, so they're available via fetch().

A navigation from a web origin to an extension resource is blocked unless the resource is listed as web accessible. Note these corner cases:

Content scripts themselves do not need to be allowed.

The Web Accessible Resources example demonstrates the use of this element in a working extension.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-05-12 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  ...
  "web_accessible_resources": [
    {
      "resources": [ "test1.png", "test2.png" ],
      "matches": [ "https://web-accessible-resources-1.glitch.me/*" ]
    }, {
      "resources": [ "test3.png", "test4.png" ],
      "matches": [ "https://web-accessible-resources-2.glitch.me/*" ],
      "use_dynamic_url": true
    }
  ],
  ...
}
```

---

## Manifest for managed storage Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/storage

**Contents:**
- Manifest for managed storage Stay organized with collections Save and categorize content based on your preferences.
- Sample manifest.json
- Schema format
- Sample schema

Unlike the local and sync storage areas, the managed storage area requires its structure to be declared as JSON Schema and is strictly validated by Chrome. This schema must be stored in a file indicated by the "managed_schema" property of the "storage" manifest key and declares the enterprise policies supported by the extension.

Policies are analogous to options but are configured by a system administrator for policy installed extensions, allowing the extension to be preconfigured for all users of an organization. See how Chrome handles policies for examples from Chrome itself.

After declaring the policies they can be read from the storage.managed API. It's up to the extension to enforce the policies configured by the administrator.

The storage.managed_schema property indicates a file within the extension that contains the policy schema.

Chrome will then load these policies from the underlying operating system and from Google Apps for signed-in users. The storage.onChanged event is fired whenever a policy change is detected. You can verify the policies that Chrome loaded at chrome://policy.

The JSON Schema format has some additional requirements from Chrome:

If the schema is invalid then Chrome won't load the extension and will indicate the reason why the schema wasn't validated. If a policy value does not conform to the schema then it won't be published by the storage.managed API.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-12-06 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My enterprise extension",
  "storage": {
    "managed_schema": "schema.json"
  },
  ...
}
```

Example 2 (unknown):
```unknown
{
  "type": "object",

  // "properties" maps an optional key of this object to its schema. At the
  // top-level object, these keys are the policy names supported.
  "properties": {

    // The policy name "AutoSave" is mapped to its schema, which in this case
    // declares it as a simple boolean value.
    // "title" and "description" are optional and are used to show a
    // user-friendly name and documentation to the administrator.
    "AutoSave": {
      "title": "Automatically save changes.",
      "description": "If set to true then changes will be automatically saved.",
      "type"
...
```

---

## Migrate to Manifest V3 Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/migrating/

**Contents:**
- Migrate to Manifest V3 Stay organized with collections Save and categorize content based on your preferences.
- Keep the current set of features
- New extension platform features

A guide to converting Manifest V2 extensions to Manifest V3 extensions.

This section helps you upgrade an extension from Manifest V2 to Manifest V3, the newest version of the Chrome Extensions platform. Migration work is broadly divided into the categories below. To help you track your work, we've provided a checklist summarizing the contents of these documents. You can access the content via the checklist, or dive into the content. Both paths end with an upgraded extension.

We also have an Extension Manifest Converter. It does not do everything for you, but it will get you started. The converter's README describes what the tool changes.

To reduce the chances of unexpected issues or bugs, we recommend not adding new functionality when migrating. For instance, adding a feature that requires new permissions may trigger a permission warning, which will disable your extension until the user accepts the new permissions. See Permission warning best practices to learn of other ways to add permissions without displaying a warning.

Manifest V3 is supported generally in Chrome 88 or later. When updating API calls, you may find that replacement features may not have landed in Chrome until after version 88. The API reference pages contain support information for individual API members. If you discover that you need one of these features, you can specify a minimum chrome version in the manifest file.

Since the release of Manifest V3, we've continued to add new features, many of which are usable in both Manifest V2 and Manifest V3. You are not required to use them when converting; however, when they replace older features, you should prefer them to the features they replace and expect that the replaced features will eventually be deprecated and removed.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2024-02-14 UTC.

---

## Manifest - Description Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/description

**Contents:**
- Manifest - Description Stay organized with collections Save and categorize content based on your preferences.

A plain text string (no HTML or other formatting; no more than 132 characters) that describes the extension. For example:

The description should be suitable for both the browser's Extensions page (chrome://extensions) and the Chrome Web Store. You can specify locale-specific strings for this field; see Internationalization for details.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-05-12 UTC.

**Examples:**

Example 1 (unknown):
```unknown
"description": "A description of my extension"
```

---

## Manifest - content scripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts

**Contents:**
- Manifest - content scripts Stay organized with collections Save and categorize content based on your preferences.
- Manifest
- Files
- Match URLs
  - Globs and URL matching examples
    - "include_globs"
    - "exclude_globs"
    - Advanced customization example
- Frames
- Run time and execution environment

The "content_scripts" key specifies a statically loaded JavaScript or CSS file to be used every time a page is opened that matches a certain URL pattern. Extensions can also inject content scripts programmatically, see Injecting Scripts for details.

These are the supported keys for "content_scripts". Only the "matches" key and either "js" or "css" are required.

Each file must contain a relative path to a resource in the extension's root directory. Leading slashes (/) are automatically trimmed. The "run_at" key specifies when each file will be injected.

Only the "matches" property is required. Then you can use "exclude_matches", "include_globs", and "exclude_globs" to customize which URLs to inject code into. The "matches" key will trigger a warning.

Glob URLs are those that contain "wildcards" * and question marks. The wildcard * matches any string of any length, including an empty string, while the question mark ? matches any single character.

The content script is injected into a page if:

The "all_frames" key specifies if the content script should be injected into all frames matching the specified URL requirements. If set to false it will only inject into the topmost frame. It can be used along with "match_about_blank" to inject into an about:blank frame.

To inject into other frames like data:, blob:, and filesystem:, set the "match_origin_as_fallback" to true. For details, see Inject in related frames

By default, content scripts are injected when the document and all resources are finished loading, and live in a private isolated execution environment that isn't accessible to the page or other extensions. You can change these defaults in the following keys:

See the Run on every page tutorial to build an extension that injects a content script in the manifest.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-08-10 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
 "name": "My extension",
 ...
 "content_scripts": [
   {
     "matches": ["https://*.example.com/*"],
     "css": ["my-styles.css"],
     "js": ["content-script.js"],
     "exclude_matches": ["*://*/*foo*"],
     "include_globs": ["*example.com/???s/*"],
     "exclude_globs": ["*bar*"],
     "all_frames": false,
     "match_origin_as_fallback": false,
     "match_about_blank": false,
     "run_at": "document_idle",
     "world": "ISOLATED",
   }
 ],
 ...
}
```

Example 2 (unknown):
```unknown
{
  ...
  "content_scripts": [
    {
      "matches": ["https://*.example.com/*"],
      "include_globs": ["https://???.example.com/foo/*"],
      "js": ["content-script.js"]
    }
  ],
  ...
}
```

Example 3 (unknown):
```unknown
{
  ...
  "content_scripts": [
    {
      "matches": ["https://*.example.com/*"],
      "include_globs": ["*example.com/???s/*"],
      "js": ["content-script.js"]
    }
  ],
  ...
}
```

Example 4 (unknown):
```unknown
{
  ...
  "content_scripts": [
    {
      "matches": ["https://*.example.com/*"],
      "exclude_globs": ["*science*"],
      "js": ["content-script.js"]
    }
  ],
  ...
}
```

---

## chrome.userScripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/userScripts

**Contents:**
- chrome.userScripts Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Concepts and usage
  - Enable usage of the userScripts API
    - Chrome versions prior to 138 (Developer mode toggle)
    - Chrome versions 138 and newer (Allow User Scripts toggle)
  - Check for API availability
  - Work in isolated worlds

Description Use the userScripts API to execute user scripts in the User Scripts context.

Use the userScripts API to execute user scripts in the User Scripts context.

Permissions userScripts

To use the User Scripts API, chrome.userScripts, add the "userScripts" permission to your manifest.json and "host_permissions" for sites you want to run scripts on.

Availability Chrome 120+ MV3+

A user script is a snippet of code injected into a web page to modify its appearance or behavior. Unlike other extension features, such as Content Scripts and the chrome.scripting API, the User Scripts API lets you run arbitrary code. This API is required for extensions that run scripts provided by the user that cannot be shipped as part of your extension package.

After your extension receives the permission to use the userScripts API, users must enable a specific toggle to allow your extension to use the API. The specific toggle required, and the API's behavior when disabled, vary by Chrome version.

Use the following check to determine which toggle the user needs to enable, for example, during new user onboarding:

The following sections describe the different toggles and how to enable them.

AAs an extension developer, you already have Developer mode enabled in your installation of Chrome. Your users must also enable Developer mode.

You can copy and paste the following instructions into your extension's documentation for your users

Enable Developer Mode by clicking the toggle switch next to Developer mode.

Extensions page (chrome://extensions)

The Allow User Scripts toggle is on each extension's details page (for example, chrome://extensions/?id=YOUR_EXTENSION_ID).

You can copy and paste the following instructions into your extension's documentation for your users:

We recommend the following check to determine if the userScripts API is enabled, as it works in all Chrome versions. This check attempts to call a chrome.userScripts() method that should always succeed when the API is available. If this call throws an error, the API is not available:

Both user and content scripts can run in an isolated world or in the main world. An isolated world is an execution environment that isn't accessible to a host page or other extensions. This lets a user script change its JavaScript environment without affecting the host page or other extensions' user and content scripts. Conversely, user scripts (and content scripts) are not visible to the host page or the user and content 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "User script test extension",
  "manifest_version": 3,
  "minimum_chrome_version": "120",
  "permissions": [
    "userScripts"
  ],
  "host_permissions": [
    "*://example.com/*"
  ]
}
```

Example 2 (javascript):
```javascript
let version = Number(navigator.userAgent.match(/(Chrome|Chromium)\/([0-9]+)/)?.[2]);
if (version >= 138) {
  // Allow User Scripts toggle will be used.
} else {
  // Developer mode toggle will be used.
}
```

Example 3 (unknown):
```unknown
function isUserScriptsAvailable() {
  try {
    // Method call which throws if API permission or toggle is not enabled.
    chrome.userScripts.getScripts();
    return true;
  } catch {
    // Not available.
    return false;
  }
}
```

Example 4 (unknown):
```unknown
chrome.userScripts.configureWorld({
  csp: "script-src 'self'"
});
```

---

## Manifest - Icons Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/icons

**Contents:**
- Manifest - Icons Stay organized with collections Save and categorize content based on your preferences.

One or more icons that represent the extension or theme. You should always provide a 128x128 icon; it's used during installation and by the Chrome Web Store. Extensions should also provide a 48x48 icon, which is used in the extensions management page (chrome://extensions). You can also specify a 16x16 icon to be used as the favicon for an extension's pages.

Icons should generally be in PNG format, because PNG has the best support for transparency. They can, however, be in any raster format supported by Blink, including BMP, GIF, ICO, and JPEG.

Here's an example of how to declare the icons in the manifest:

See Extension icons details on Chrome Web Store requirements and best practices.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-05-12 UTC.

**Examples:**

Example 1 (unknown):
```unknown
 "icons": {
    "16": "icon16.png",
    "32": "icon32.png",
    "48": "icon48.png",
    "128": "icon128.png"
  },
```

---

## Manifest - Sandbox Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/sandbox

**Contents:**
- Manifest - Sandbox Stay organized with collections Save and categorize content based on your preferences.

Defines a collection of extension pages that are to be served in a sandboxed unique origin. The Content Security Policy used by an extension's sandboxed pages is specified in the "content_security_policy" key.

Being in a sandbox has two implications:

For example, here's how to specify that two extension pages are to be served in a sandbox with a custom CSP:

If not specified, the default "content_security_policy" value is sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; child-src 'self';.

You can specify your CSP value to restrict the sandbox even further, but it MUST include the "sandbox" directive and MUST NOT have the allow-same-origin token (see the HTML5 specification for possible sandbox tokens).

Note that you only need to list pages that you expect to be loaded in windows or frames. Resources used by sandboxed pages (e.g. stylesheets or JavaScript source files) don't need to appear in the pages list because they will use the sandbox of the frame that embeds them.

"Using eval() in Chrome Extensions" goes into more detail about implementing a sandboxing workflow that enables the use of libraries that would otherwise have issues executing under extension's default Content Security Policy.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-05-12 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  ...
  "content_security_policy": {
    "sandbox": "sandbox allow-scripts; script-src 'self' https://example.com"
  },
  "sandbox": {
    "pages": [
      "page1.html",
      "directory/page2.html"
    ]
  },
  ...
}
```

---

## Overriding Chrome settings Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/chrome-settings-override

**Contents:**
- Overriding Chrome settings Stay organized with collections Save and categorize content based on your preferences.
- Homepage, search provider, and startup pages
- Customizing values
- Reference

Settings overrides are a way for extensions to override selected Chrome settings. The API is available on Windows and Mac in all current versions of Chrome.

Here is an example of how homepage, search provider, and startup pages can be modified in the extension manifest. Any domain used in the settings API must be verified (via Google Search Console) by the same developer account publishing the extension. Note that if you verify ownership for a domain (for example, https://example.com) you can use any subdomain or page (for example, https://app.example.com or https://example.com/page.html) within your extension.

Using the settings override permission while also requesting any additional capabilities or permissions is inconsistent with our single purpose policy. When Chrome detects that an item is potentially violating our single purpose policy, a confirmation dialog is shown to the user. Extensions that limit themselves to only modifying a single setting without seeking additional capabilities or permissions do not get a confirmation dialog.

This applies to Chrome 107 and later.

Values in the manifest can be customized in the following ways:

For external extensions, the search_provider, homepage and startup_pages URL values can be parametrized using a registry key. Create a new registry entry next to the "update_url" key (see instructions here). The key name is "install_parameter", the value is an arbitrary string:

All occurrences of the substring "__PARAM__" in the manifest URLs will be substituted with the "install_parameter" value. If "install_parameter" is absent, occurrences of "__PARAM__" are removed. Note that "__PARAM__" cannot be part of the hostname. It needs to occur after the first '/' in the URL.

An extension can override one or more of the following properties in the manifest:

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2014-02-14 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "chrome_settings_overrides": {
    "homepage": "https://www.homepage.com",
    "search_provider": {
        "name": "name.__MSG_url_domain__",
        "keyword": "keyword.__MSG_url_domain__",
        "search_url": "https://www.foo.__MSG_url_domain__/s?q={searchTerms}",
        "favicon_url": "https://www.foo.__MSG_url_domain__/favicon.ico",
        "suggest_url": "https://www.foo.__MSG_url_domain__/suggest?q={searchTerms}",
        "instant_url": "https://www.foo.__MSG_url_domain__/instant?q={searchTerms}",
        "image_url": "https://www.foo.__MSG_url_dom
...
```

Example 2 (unknown):
```unknown
{
  "update_url": "https://clients2.google.com/service/update2/crx",
  "install_parameter": "Value"
}
```

---

## API reference Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api

**Contents:**
- API reference Stay organized with collections Save and categorize content based on your preferences.
- Common Extensions API features
- Chrome Extension APIs

Most extensions need access to one or more Chrome Extensions APIs to function. This API reference describes the APIs available for use in extensions and presents example use cases.

An Extensions API consists of a namespace containing methods and properties for doing extensions work, and usually, but not always, manifest fields for the manifest.json file. For example, the chrome.action namespace requires an "action" object in the manifest. Many APIs also require permissions in the manifest.

Methods in extension APIs are asynchronous unless stated otherwise. Asynchronous methods return immediately, without waiting for the operation that calls them to finish. Use promises to get the results of these asynchronous methods.

Use the chrome.accessibilityFeatures API to manage Chrome's accessibility features. This API relies on the ChromeSetting prototype of the type API for getting and setting individual accessibility features. In order to get feature states the extension must request accessibilityFeatures.read permission. For modifying feature state, the extension needs accessibilityFeatures.modify permission. Note that accessibilityFeatures.modify does not imply accessibilityFeatures.read permission.

Use the chrome.action API to control the extension's icon in the Google Chrome toolbar.

Use the chrome.alarms API to schedule code to run periodically or at a specified time in the future.

The chrome.audio API is provided to allow users to get information about and control the audio devices attached to the system. This API is currently only available in kiosk mode for ChromeOS.

Use the chrome.bookmarks API to create, organize, and otherwise manipulate bookmarks. Also see Override Pages, which you can use to create a custom Bookmark Manager page.

Use the chrome.browsingData API to remove browsing data from a user's local profile.

Use this API to expose certificates to the platform which can use these certificates for TLS authentications.

Use the commands API to add keyboard shortcuts that trigger actions in your extension, for example, an action to open the browser action or send a command to the extension.

Use the chrome.contentSettings API to change settings that control whether websites can use features such as cookies, JavaScript, and plugins. More generally speaking, content settings allow you to customize Chrome's behavior on a per-site basis instead of globally.

Use the chrome.contextMenus API to add items to Google Chrome's context menu. You can c

*[Content truncated]*

---

## Manifest file format Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/manifest/

**Contents:**
- Manifest file format Stay organized with collections Save and categorize content based on your preferences.
- Examples
  - Minimal manifest
  - Register a content script
  - Inject a content script
  - Popup with permissions
  - Side panel
- Manifest keys
  - Keys required by the Extensions platform
  - Keys required by Chrome Web Store

Every extension must have a manifest.json file in its root directory that lists important information about the structure and behavior of that extension. This page explains the structure of extension manifests and the features they can include.

The following example manifests show the basic manifest structure and some commonly used features as a starting point for creating your own manifest:

The following is a list of all supported manifest keys.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2012-09-18 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Minimal Manifest",
  "version": "1.0.0",
  "description": "A basic example extension with only required keys",
  "icons": {
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  }
}
```

Example 2 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Run script automatically",
  "description": "Runs a script on www.example.com automatically when user installs the extension",
  "version": "1.0",
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  },
  "content_scripts": [
    {
      "js": [
        "content-script.js"
      ],
      "matches": [
        "http://*.example.com//"
      ]
    }
  ]
}
```

Example 3 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Click to run",
  "description": "Runs a script when the user clicks the action toolbar icon.",
  "version": "1.0",
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  },
  "background": {
    "service_worker": "service-worker.js"
  },
  "action": {
    "default_icon": {
      "16": "images/icon-16.png",
      "32": "images/icon-32.png",
      "48": "images/icon-48.png",
      "128": "images/icon-128.png"
    }
  },
  "permissions": ["scripting", "activeTab"]
}
```

Example 4 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Popup extension that requests permissions",
  "description": "Extension that includes a popup and requests host permissions and storage permissions .",
  "version": "1.0",
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "host_permissions": [
    "https://*.example.com/"
  ],
  "permissions": [
    "storage"
  ]
}
```

---

## chrome.userScripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/userScripts#method-execute

**Contents:**
- chrome.userScripts Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Concepts and usage
  - Enable usage of the userScripts API
    - Chrome versions prior to 138 (Developer mode toggle)
    - Chrome versions 138 and newer (Allow User Scripts toggle)
  - Check for API availability
  - Work in isolated worlds

Description Use the userScripts API to execute user scripts in the User Scripts context.

Use the userScripts API to execute user scripts in the User Scripts context.

Permissions userScripts

To use the User Scripts API, chrome.userScripts, add the "userScripts" permission to your manifest.json and "host_permissions" for sites you want to run scripts on.

Availability Chrome 120+ MV3+

A user script is a snippet of code injected into a web page to modify its appearance or behavior. Unlike other extension features, such as Content Scripts and the chrome.scripting API, the User Scripts API lets you run arbitrary code. This API is required for extensions that run scripts provided by the user that cannot be shipped as part of your extension package.

After your extension receives the permission to use the userScripts API, users must enable a specific toggle to allow your extension to use the API. The specific toggle required, and the API's behavior when disabled, vary by Chrome version.

Use the following check to determine which toggle the user needs to enable, for example, during new user onboarding:

The following sections describe the different toggles and how to enable them.

AAs an extension developer, you already have Developer mode enabled in your installation of Chrome. Your users must also enable Developer mode.

You can copy and paste the following instructions into your extension's documentation for your users

Enable Developer Mode by clicking the toggle switch next to Developer mode.

Extensions page (chrome://extensions)

The Allow User Scripts toggle is on each extension's details page (for example, chrome://extensions/?id=YOUR_EXTENSION_ID).

You can copy and paste the following instructions into your extension's documentation for your users:

We recommend the following check to determine if the userScripts API is enabled, as it works in all Chrome versions. This check attempts to call a chrome.userScripts() method that should always succeed when the API is available. If this call throws an error, the API is not available:

Both user and content scripts can run in an isolated world or in the main world. An isolated world is an execution environment that isn't accessible to a host page or other extensions. This lets a user script change its JavaScript environment without affecting the host page or other extensions' user and content scripts. Conversely, user scripts (and content scripts) are not visible to the host page or the user and content 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "User script test extension",
  "manifest_version": 3,
  "minimum_chrome_version": "120",
  "permissions": [
    "userScripts"
  ],
  "host_permissions": [
    "*://example.com/*"
  ]
}
```

Example 2 (javascript):
```javascript
let version = Number(navigator.userAgent.match(/(Chrome|Chromium)\/([0-9]+)/)?.[2]);
if (version >= 138) {
  // Allow User Scripts toggle will be used.
} else {
  // Developer mode toggle will be used.
}
```

Example 3 (unknown):
```unknown
function isUserScriptsAvailable() {
  try {
    // Method call which throws if API permission or toggle is not enabled.
    chrome.userScripts.getScripts();
    return true;
  } catch {
    // Not available.
    return false;
  }
}
```

Example 4 (unknown):
```unknown
chrome.userScripts.configureWorld({
  csp: "script-src 'self'"
});
```

---

## Known issues when migrating to Manifest V3 Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/migrate/known-issues

**Contents:**
- Known issues when migrating to Manifest V3 Stay organized with collections Save and categorize content based on your preferences.
- Closing the platform gap
- Manifest V3 frequently asked questions

Recently, we announced changes to the Manifest V2 deprecation timeline, and while we remain firmly committed to Manifest V3 we acknowledge there is more work to do on our part.

We are committed to closing the following gaps before announcing a new Manifest V2 deprecation timeline:

Issues were collected based on feedback from partners, bug reports, and developers. We will continue our ongoing work to improve stability and overall performance of the extension platform.

There are currently no open issues considered a critical platform gap.

The following issues have recently been addressed:

Q: Do we plan to support persistent Service Workers? A: One of the key reasons for migrating from background scripts to service workers is the more memory efficient event-driven programming model which comes from the ephemeral nature of service workers. Consequently, we are not planning to support persistent service workers. However, to address the specific needs of extension developers, we are continuing to make many improvements to service workers. In particular:

Q: Is there a way to access the DOM in service workers? A: We follow the approach taken by the Web Platform of not including DOM access in web workers (which includes service workers). To support use cases requiring background DOM access from service workers we’ve introduced the possibility to delegate background work to short-lived Offscreen documents which provide full DOM access.

Q: Will there be a way to support remote code in Manifest V3? A: To make Chrome Extensions more secure, we will continue to disallow executing arbitrary remotely hosted code in Chrome extensions. However, this does not mean we disallow all kinds of dynamic code execution. We still support different options of dynamically executing code in Chrome extensions:

Q: My Manifest V2 extension relies on webRequestBlocking which is not supported in Manifest V3. How can I continue to provide the same functionality in Manifest V3? A: We are confident that most request blocking use cases can be solved with the new declarativeNetRequest API, which has the added benefit of avoiding the performance overhead of interprocess communication, executing code on every request, or requiring an active extension process at the time of the request. However, for complex enterprise (or education) use cases, dynamic request blocking is still supported.

Did we miss something? Please let us know.

Except as otherwise noted, the content of this page is licen

*[Content truncated]*

---

## Manifest - Content Security Policy Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy

**Contents:**
- Manifest - Content Security Policy Stay organized with collections Save and categorize content based on your preferences.
- Default Policy
- Minimum and customized Content Security Policies
  - Extension Pages Policy
  - Sandbox Pages Policy

An optional manifest key containing a web platform content security policy which specifies restrictions on the scripts, styles, and other resources an extension can use. Within this manifest key, separate optional policies can be defined for both extension pages and sandboxed extension pages.

The "extension pages" policy applies to page and worker contexts in the extension. This would include the extension popup, background worker, and tabs with HTML pages or iframes that were opened by the extension. The sandbox policy applies to all pages specified as a sandbox page in the manifest.

If the content security policy is not defined by the user in the manifest, the default properties will be used for both extension pages and sandboxed extension pages.

These defaults are equivalent to specifying the following policies in your manifest:

In this case, the extension will only load local scripts and objects from its own packaged resources. WebAssembly will be disabled, and the extension won't run inline Javascript or be able to evaluate strings as executable code. If a sandbox page is added, it will have more relaxed permissions for evaluating scripts from outside the extension.

Developers may add or remove rules for their extension, or use the minimum required content security policy, to fit the needs of their project.

Chrome enforces a minimum content security policy for extension pages. It is equivalent to specifying the following policy in your manifest:

The extension_pages policy cannot be relaxed beyond this minimum value. In other words, you cannot add other script sources to directives, such as adding 'unsafe-eval' to script-src. If you add a disallowed source to your extension's policy, Chrome will throw an error like this at install time:

The default policy for sandboxed pages is much more lenient than with extension pages, as the sandbox page does not have access to extension APIs, or direct access to non-sandboxed pages. The sandbox content security policy can be customized as needed.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2024-02-13 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  // ...
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self';",
    "sandbox": "sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; child-src 'self';"
  }
  // ...
}
```

Example 2 (unknown):
```unknown
{
  // ...
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  }
  // ...
}
```

Example 3 (unknown):
```unknown
'content_security_policy.extension_pages': Insecure CSP value "'unsafe-eval'" in directive 'script-src'.
```

---

## Manifest - Requirements Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/requirements

**Contents:**
- Manifest - Requirements Stay organized with collections Save and categorize content based on your preferences.

Technologies required by the extension. Hosting sites such as the Chrome Web Store may use this list to dissuade users from installing extensions that will not work on their computer. Additional requirements checks may be added in the future.

The "3D" requirement denotes GPU hardware acceleration and takes either "webgl" or "css3d" as valid values. The "webgl" requirement refers to the WebGL API. For more information on Chrome 3D graphics support, see the help article on WebGL and 3D graphics. You can list the 3D-related features your extension requires, as demonstrated in the following example:

NPAPI Plugin support for extensions has been discontinued as of Chrome version 45. As part of this, the "plugins" requirement has been deprecated, and can no longer be used in a manifest file.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-05-12 UTC.

**Examples:**

Example 1 (unknown):
```unknown
"requirements": {
  "3D": {
    "features": ["webgl"]
  }
}
```

---

## Manifest - Minimum Chrome Version Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version

**Contents:**
- Manifest - Minimum Chrome Version Stay organized with collections Save and categorize content based on your preferences.
- Enforcement
  - New Installs
  - Existing Installs

An optional manifest key containing a string that defines which versions of Chrome are able to install the extension. The value set for this string must be a substring of an existing Chrome browser version string. Use a full version number to specify a specific update to Chrome, or use the first number in the string to specify a particular major version.

In versions of Chrome older than the minimum version, the Chrome Web Store will show a "Not compatible" message in place of the install button. Users on these versions won't be able to install your extension.

Existing users of your extension won't receive updates when the minimum_chrome_version is higher than their current browser version. This happens silently so you should exercise caution and consider ways of letting existing users know that they are no longer receiving updates.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2024-04-26 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  // ...
  "minimum_chrome_version": "126",
  // ...
}
```

---

## Shared modules Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/shared-modules#export

**Contents:**
- Shared modules Stay organized with collections Save and categorize content based on your preferences.
- Manifest
  - Export
  - Import
- Accessing resources
- Install / uninstall

Shared Modules are permissionless collections of resources that can be shared between extensions. Common uses of Shared Modules are:

Shared Modules are used through two manifest fields: "export" and "import".

The export field indicates an extension is a Shared Module that exports its resources:

The import field is used by extensions and apps to declare that they depend on the resources from particular Shared Modules:

Shared Module resources are accessed by a reserved path _modules/SHARED_MODULE_ID in the root of your importing extension. For example, to include the script foo.js from a Shared Module with ID "cccccccccccccccccccccccccccccccc", use this path from the root of your extension:

If the importing extension has ID "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", then the full URL to resources in the Shared Module is:

Note that since resources from Shared Modules are overlaid into the origin of the importing extension, all privileges granted to the importing extension are available to code in Shared Modules. Also, the Shared Module can access resources in the importing extension by using absolute paths.

A Shared Module is automatically installed from the Chrome Web Store when needed by a dependent extension and automatically uninstalled when the last extension which references it is uninstalled. To upload an extension that uses a Shared Module, the Shared Module must be published in the Chrome Web Store and the extension must not be restricted from using the Shared Module by its allowlist.

During development, you will need to manually install any Shared Modules your extension uses. Automatic installs do not happen for extensions that are side-loaded or loaded as unpacked extensions. For locally installed, unpacked Shared Modules, you must use the key field to ensure the Shared Modules use the correct IDs.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2015-01-05 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "version": "1.0",
  "name": "My Shared Module",
  "export": {
    // Optional list of extension IDs explicitly allowed to
    // import this Shared Module's resources.  If no allowlist
    // is given, all extensions are allowed to import it.
    "allowlist": [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    ]
  }
  // Note: no permissions are allowed in Shared Modules
}
```

Example 2 (unknown):
```unknown
{
  "version": "1.0",
  "name": "My Importing Extension",
  ...
  "import": [
    {"id": "cccccccccccccccccccccccccccccccc"},
    {"id": "dddddddddddddddddddddddddddddddd"
     "minimum_version": "0.5" // optional
    },
  ]
}
```

Example 3 (unknown):
```unknown
<script src="_modules/cccccccccccccccccccccccccccccccc/foo.js">
```

Example 4 (unknown):
```unknown
chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/_modules/cccccccccccccccccccccccccccccccc/
```

---

## chrome.runtime Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getManifest

**Contents:**
- chrome.runtime Stay organized with collections Save and categorize content based on your preferences.
- Description
- Concepts and usage
  - Unpacked extension behavior
- Use cases
  - Add an image to a web page
  - Send data from a content script to the service worker
  - Gather feedback on uninstall
- Examples
- Types

Description Use the chrome.runtime API to retrieve the service worker, return details about the manifest, and listen for and respond to events in the extension lifecycle. You can also use this API to convert the relative path of URLs to fully-qualified URLs.

Use the chrome.runtime API to retrieve the service worker, return details about the manifest, and listen for and respond to events in the extension lifecycle. You can also use this API to convert the relative path of URLs to fully-qualified URLs.

Most members of this API do not require any permissions. This permission is needed for connectNative(), sendNativeMessage() and onNativeConnect.

The following example shows how to declare the "nativeMessaging" permission in the manifest:

The Runtime API provides methods to support a number of areas that your extensions can use:

When an unpacked extension is reloaded, this is treated as an update. This means that the chrome.runtime.onInstalled event will fire with the "update" reason. This includes when the extension is reloaded with chrome.runtime.reload().

For a web page to access an asset hosted on another domain, it must specify the resource's full URL (e.g. <img src="https://example.com/logo.png">). The same is true to include an extension asset on a web page. The two differences are that the extension's assets must be exposed as web accessible resources and that typically content scripts are responsible for injecting extension assets.

In this example, the extension will add logo.png to the page that the content script is being injected into by using runtime.getURL() to create a fully-qualified URL. But first, the asset must be declared as a web accessible resource in the manifest.

Its common for an extension's content scripts to need data managed by another part of the extension, like the service worker. Much like two browser windows opened to the same web page, these two contexts cannot directly access each other's values. Instead, the extension can use message passing to coordinate across these different contexts.

In this example, the content script needs some data from the extension's service worker to initialize its UI. To get this data, it passes the developer-defined get-user-data message to the service worker, and it responds with a copy of the user's information.

Many extensions use post-uninstall surveys to understand how the extension could better serve its users and improve retention. The following example shows how to add this functi

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "nativeMessaging"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
{
  ...
  "web_accessible_resources": [
    {
      "resources": [ "logo.png" ],
      "matches": [ "https://*/*" ]
    }
  ],
  ...
}
```

Example 3 (javascript):
```javascript
{ // Block used to avoid setting global variables
  const img = document.createElement('img');
  img.src = chrome.runtime.getURL('logo.png');
  document.body.append(img);
}
```

Example 4 (javascript):
```javascript
// 1. Send a message to the service worker requesting the user's data
chrome.runtime.sendMessage('get-user-data', (response) => {
  // 3. Got an asynchronous response with the data from the service worker
  console.log('received user data', response);
  initializeUI(response);
});
```

---

## Manifest - Incognito Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/incognito

**Contents:**
- Manifest - Incognito Stay organized with collections Save and categorize content based on your preferences.
- Spanning mode
- Split mode
- Not allowed
- How to choose

Use the "incognito" manifest key with either "spanning" or "split" to specify how this extension will behave if allowed to run in incognito mode. Using "not_allowed" to prevent this extension from being enabled in incognito mode.

The default mode is "spanning", which means that the extension will run in a single shared process. Any events or messages from an incognito tab will be sent to the shared process, with an incognito flag indicating where it came from. Because incognito tabs cannot use this shared process, an extension using the "spanning" incognito mode will not be able to load pages from its extension package into the main frame of an incognito tab.

The "split" mode means that all pages in an incognito window will run in their own incognito process. If the extension contains a background page, that will also run in the incognito process. This incognito process runs along side the regular process, but has a separate memory-only cookie store. Each process sees events and messages only from its own context (for example, the incognito process will see only incognito tab updates). The processes are unable to communicate with each other.

The extension cannot be enabled in incognito mode. Available from Chrome 47.

As a rule of thumb, if your extension needs to load a tab in an incognito browser, use split incognito behavior. If your extension needs to be logged into a remote server use spanning incognito behavior.

chrome.storage.sync and chrome.storage.local are always shared between regular and incognito processes. It is recommended to use them for persisting your extension's settings.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-05-12 UTC.

---

## externally_connectable Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable

**Contents:**
- externally_connectable Stay organized with collections Save and categorize content based on your preferences.
- Connect without externally_connectable
- Manifest
- Reference

The "externally_connectable" manifest property declares which extensions and web pages can connect to your extension using runtime.connect() and runtime.sendMessage().

For a tutorial on message passing, see cross-extension messaging and sending messages from web pages.

If the externally_connectable key is not declared in your extension's manifest, all extensions can connect, but no web pages can connect. As a consequence, when updating your manifest to use externally_connectable, if "ids": ["*"] is not specified, then other extensions will lose the ability to connect to your extension. This may be an unintended consequence, so keep it in mind.

The "externally_connectable" manifest key includes the following optional properties:

This does not affect content scripts.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-08-21 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My externally connectable extension",
  "externally_connectable": {
    "ids": [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ...
    ],
    // If this field is not specified, no web pages can connect.
    "matches": [
      "https://*.google.com/*",
      "*://*.chromium.org/*",
      ...
    ],
    "accepts_tls_channel_id": false
  },
  ...
}
```

---

## Migrate to Manifest V3 Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/intro/mv3-overview

**Contents:**
- Migrate to Manifest V3 Stay organized with collections Save and categorize content based on your preferences.
- Keep the current set of features
- New extension platform features

A guide to converting Manifest V2 extensions to Manifest V3 extensions.

This section helps you upgrade an extension from Manifest V2 to Manifest V3, the newest version of the Chrome Extensions platform. Migration work is broadly divided into the categories below. To help you track your work, we've provided a checklist summarizing the contents of these documents. You can access the content via the checklist, or dive into the content. Both paths end with an upgraded extension.

We also have an Extension Manifest Converter. It does not do everything for you, but it will get you started. The converter's README describes what the tool changes.

To reduce the chances of unexpected issues or bugs, we recommend not adding new functionality when migrating. For instance, adding a feature that requires new permissions may trigger a permission warning, which will disable your extension until the user accepts the new permissions. See Permission warning best practices to learn of other ways to add permissions without displaying a warning.

Manifest V3 is supported generally in Chrome 88 or later. When updating API calls, you may find that replacement features may not have landed in Chrome until after version 88. The API reference pages contain support information for individual API members. If you discover that you need one of these features, you can specify a minimum chrome version in the manifest file.

Since the release of Manifest V3, we've continued to add new features, many of which are usable in both Manifest V2 and Manifest V3. You are not required to use them when converting; however, when they replace older features, you should prefer them to the features they replace and expect that the replaced features will eventually be deprecated and removed.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2024-02-14 UTC.

---

## file_handlers Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/file-handlers

**Contents:**
- file_handlers Stay organized with collections Save and categorize content based on your preferences.

The "file_handlers" manifest key specifies file types to be handled by a ChromeOS extension. To process a file, use the web platform's Launch Handler API. For extension specific information, see File Handling.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-11-01 UTC.

**Examples:**

Example 1 (unknown):
```unknown
"file_handlers": [
  {
    "action": "/open_text.html",
    "name": "Plain text",
    "accept": {
      "text/plain": [".txt"]
    }
    "launch_type": "single-client"
  }
]
```

---

## Manifest - background Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/background

**Contents:**
- Manifest - background Stay organized with collections Save and categorize content based on your preferences.

An optional manifest key used to specify a javascript file as the extension service worker. A service worker is a background script that acts as the extension's main event handler. For more information, visit the more comprehensive introduction to service workers.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-05-24 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  ...
   "background": {
      "service_worker": "service-worker.js",
      "type": "module"
    },
  ...
}
```

---

## Manifest file format Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/manifest

**Contents:**
- Manifest file format Stay organized with collections Save and categorize content based on your preferences.
- Examples
  - Minimal manifest
  - Register a content script
  - Inject a content script
  - Popup with permissions
  - Side panel
- Manifest keys
  - Keys required by the Extensions platform
  - Keys required by Chrome Web Store

Every extension must have a manifest.json file in its root directory that lists important information about the structure and behavior of that extension. This page explains the structure of extension manifests and the features they can include.

The following example manifests show the basic manifest structure and some commonly used features as a starting point for creating your own manifest:

The following is a list of all supported manifest keys.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2012-09-18 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Minimal Manifest",
  "version": "1.0.0",
  "description": "A basic example extension with only required keys",
  "icons": {
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  }
}
```

Example 2 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Run script automatically",
  "description": "Runs a script on www.example.com automatically when user installs the extension",
  "version": "1.0",
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  },
  "content_scripts": [
    {
      "js": [
        "content-script.js"
      ],
      "matches": [
        "http://*.example.com//"
      ]
    }
  ]
}
```

Example 3 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Click to run",
  "description": "Runs a script when the user clicks the action toolbar icon.",
  "version": "1.0",
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  },
  "background": {
    "service_worker": "service-worker.js"
  },
  "action": {
    "default_icon": {
      "16": "images/icon-16.png",
      "32": "images/icon-32.png",
      "48": "images/icon-48.png",
      "128": "images/icon-128.png"
    }
  },
  "permissions": ["scripting", "activeTab"]
}
```

Example 4 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Popup extension that requests permissions",
  "description": "Extension that includes a popup and requests host permissions and storage permissions .",
  "version": "1.0",
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "host_permissions": [
    "https://*.example.com/"
  ],
  "permissions": [
    "storage"
  ]
}
```

---

## Manifest - Version Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/version

**Contents:**
- Manifest - Version Stay organized with collections Save and categorize content based on your preferences.
- Version name

One to four dot-separated integers identifying the version of this extension. A couple of rules apply to the integers:

Here are some examples of valid versions:

If the published extension has a newer version string than the installed extension, then the extension is automatically updated.

The comparison starts with the leftmost integers. Then, if those integers are equal, the integers to the right are compared, and so on. For example, 1.2.0 is a newer version than 1.1.9.9999.

A missing integer is equal to zero. For example, 1.1.9.9999 is newer than 1.1, and 1.1.9.9999 is older than 1.2.

In addition to the "version" field, which is used for update purposes, "version_name" can be set to a descriptive version string and will be used for display purposes if present.

Here are some examples of version names:

If no version_name is present, the version field will be used for display purposes as well.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-05-12 UTC.

---

## Manifest - input_components Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/input-components

**Contents:**
- Manifest - input_components Stay organized with collections Save and categorize content based on your preferences.

An optional Manifest key enabling the use of the input.ime API (Input Method Editor) for use with ChromeOS. This allows your extension to handle keystrokes, set the composition, and open assistive windows. Developers must also declare the "input" permission in the extension's "permissions" array. The key accepts an array of objects: name, id, language, layouts, input_view, and options_page (Refer to the table below).

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2022-10-28 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  // ...
   "input_components": [{
     "name": "ToUpperIME",
    "id": "ToUpperIME",
    "language": "en",
    "layouts": ["us::eng"]
  }]
  // ...
}
```

---

## Manifest file format Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest

**Contents:**
- Manifest file format Stay organized with collections Save and categorize content based on your preferences.
- Examples
  - Minimal manifest
  - Register a content script
  - Inject a content script
  - Popup with permissions
  - Side panel
- Manifest keys
  - Keys required by the Extensions platform
  - Keys required by Chrome Web Store

Every extension must have a manifest.json file in its root directory that lists important information about the structure and behavior of that extension. This page explains the structure of extension manifests and the features they can include.

The following example manifests show the basic manifest structure and some commonly used features as a starting point for creating your own manifest:

The following is a list of all supported manifest keys.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2012-09-18 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Minimal Manifest",
  "version": "1.0.0",
  "description": "A basic example extension with only required keys",
  "icons": {
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  }
}
```

Example 2 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Run script automatically",
  "description": "Runs a script on www.example.com automatically when user installs the extension",
  "version": "1.0",
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  },
  "content_scripts": [
    {
      "js": [
        "content-script.js"
      ],
      "matches": [
        "http://*.example.com//"
      ]
    }
  ]
}
```

Example 3 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Click to run",
  "description": "Runs a script when the user clicks the action toolbar icon.",
  "version": "1.0",
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  },
  "background": {
    "service_worker": "service-worker.js"
  },
  "action": {
    "default_icon": {
      "16": "images/icon-16.png",
      "32": "images/icon-32.png",
      "48": "images/icon-48.png",
      "128": "images/icon-128.png"
    }
  },
  "permissions": ["scripting", "activeTab"]
}
```

Example 4 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Popup extension that requests permissions",
  "description": "Extension that includes a popup and requests host permissions and storage permissions .",
  "version": "1.0",
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "host_permissions": [
    "https://*.example.com/"
  ],
  "permissions": [
    "storage"
  ]
}
```

---

## chrome.action Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/action#manifest

**Contents:**
- chrome.action Stay organized with collections Save and categorize content based on your preferences.
- Description
- Availability
- Manifest
- Concepts and usage
  - Parts of the UI
    - Icon
    - Tooltip (title)
    - Badge
    - Popup

Description Use the chrome.action API to control the extension's icon in the Google Chrome toolbar. The action icons are displayed in the browser toolbar next to the omnibox. After installation, these appear in the extensions menu (the puzzle piece icon). Users can pin your extension icon to the toolbar.

Use the chrome.action API to control the extension's icon in the Google Chrome toolbar.

Availability Chrome 88+ MV3+

Manifest The following keys must be declared in the manifest to use this API."action"

The following keys must be declared in the manifest to use this API.

To use the chrome.action API, specify a "manifest_version" of 3 and include the "action" key in your manifest file.

The "action" key (along with its children) is optional. When it isn't included, your extension is still shown in the toolbar to provide access to the extension's menu. For this reason, we recommend that you always include at least the "action" and "default_icon" keys.

The icon is the main image on the toolbar for your extension, and is set by the "default_icon" key in your manifest's "action" key. Icons must be 16 device-independent pixels (DIPs) wide and tall.

The "default_icon" key is a dictionary of sizes to image paths. Chrome uses these icons to choose which image scale to use. If an exact match is not found, Chrome selects the closest available and scales it to fit the image, which might affect image quality.

Because devices with less-common scale factors like 1.5x or 1.2x are becoming more common, we encourage you to provide multiple sizes for your icons. This also futureproofs your extension against potential icon display size changes. However, if only providing a single size, the "default_icon" key can also be set to a string with the path to a single icon instead of a dictionary.

You can also call action.setIcon() to set your extension's icon programmatically by specifying a different image path or providing a dynamically-generated icon using the HTML canvas element, or, if setting from an extension service worker, the offscreen canvas API.

For packed extensions (installed from a .crx file), images can be in most formats that the Blink rendering engine can display, including PNG, JPEG, BMP, ICO, and others. SVG isn't supported. Unpacked extensions must use PNG images.

The tooltip, or title, appears when the user holds their mouse pointer over the extension's icon in the toolbar. It's also included in the accessible text spoken by screen readers when the 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Action Extension",
  ...
  "action": {
    "default_icon": {              // optional
      "16": "images/icon16.png",   // optional
      "24": "images/icon24.png",   // optional
      "32": "images/icon32.png"    // optional
    },
    "default_title": "Click Me",   // optional, shown in tooltip
    "default_popup": "popup.html"  // optional
  },
  ...
}
```

Example 2 (javascript):
```javascript
const canvas = new OffscreenCanvas(16, 16);
const context = canvas.getContext('2d');
context.clearRect(0, 0, 16, 16);
context.fillStyle = '#00FF00';  // Green
context.fillRect(0, 0, 16, 16);
const imageData = context.getImageData(0, 0, 16, 16);
chrome.action.setIcon({imageData: imageData}, () => { /* ... */ });
```

Example 3 (javascript):
```javascript
chrome.action.setBadgeBackgroundColor(
  {color: [0, 255, 0, 0]},  // Green
  () => { /* ... */ },
);

chrome.action.setBadgeBackgroundColor(
  {color: '#00FF00'},  // Also green
  () => { /* ... */ },
);

chrome.action.setBadgeBackgroundColor(
  {color: 'green'},  // Also, also green
  () => { /* ... */ },
);
```

Example 4 (javascript):
```javascript
function getTabId() { /* ... */}
function getTabBadge() { /* ... */}

chrome.action.setBadgeText(
  {
    text: getTabBadge(tabId),
    tabId: getTabId(),
  },
  () => { ... }
);
```

---

## Manifest - key Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/key

**Contents:**
- Manifest - key Stay organized with collections Save and categorize content based on your preferences.
- Keep a consistent extension ID
  - Upload extension to the developer dashboard
  - Compare IDs

This value maintains the unique ID of an extension, or theme when it is loaded during development. The following are some common use cases:

Preserving a single ID is essential during development. To keep a consistent ID, follow these steps:

Package the extension directory into a .zip file and upload it to the Chrome Developer Dashboard without publishing it:

When the dialog is open, follow these steps:

Add the code to the manifest.json under the "key" field. This way the extension will use the same ID.

Open the Extensions Management page at chrome://extensions, ensure Developer mode is enabled, and upload the unpackaged extension directory. Compare the extension ID on the extensions management page to the Item ID in the Developer Dashboard. They should match.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-05-12 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{ // manifest.json
  "manifest_version": 3,
...
  "key": "ThisKeyIsGoingToBeVeryLong/go8GGC2u3UD9WI3MkmBgyiDPP2OreImEQhPvwpliioUMJmERZK3zPAx72z8MDvGp7Fx7ZlzuZpL4yyp4zXBI+MUhFGoqEh32oYnm4qkS4JpjWva5Ktn4YpAWxd4pSCVs8I4MZms20+yx5OlnlmWQEwQiiIwPPwG1e1jRw0Ak5duPpE3uysVGZXkGhC5FyOFM+oVXwc1kMqrrKnQiMJ3lgh59LjkX4z1cDNX3MomyUMJ+I+DaWC2VdHggB74BNANSd+zkPQeNKg3o7FetlDJya1bk8ofdNBARxHFMBtMXu/ONfCT3Q2kCY9gZDRktmNRiHG/1cXhkIcN1RWrbsCkwIDAQAB",
}
```

---

## Manifest - content scripts Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts#frames

**Contents:**
- Manifest - content scripts Stay organized with collections Save and categorize content based on your preferences.
- Manifest
- Files
- Match URLs
  - Globs and URL matching examples
    - "include_globs"
    - "exclude_globs"
    - Advanced customization example
- Frames
- Run time and execution environment

The "content_scripts" key specifies a statically loaded JavaScript or CSS file to be used every time a page is opened that matches a certain URL pattern. Extensions can also inject content scripts programmatically, see Injecting Scripts for details.

These are the supported keys for "content_scripts". Only the "matches" key and either "js" or "css" are required.

Each file must contain a relative path to a resource in the extension's root directory. Leading slashes (/) are automatically trimmed. The "run_at" key specifies when each file will be injected.

Only the "matches" property is required. Then you can use "exclude_matches", "include_globs", and "exclude_globs" to customize which URLs to inject code into. The "matches" key will trigger a warning.

Glob URLs are those that contain "wildcards" * and question marks. The wildcard * matches any string of any length, including an empty string, while the question mark ? matches any single character.

The content script is injected into a page if:

The "all_frames" key specifies if the content script should be injected into all frames matching the specified URL requirements. If set to false it will only inject into the topmost frame. It can be used along with "match_about_blank" to inject into an about:blank frame.

To inject into other frames like data:, blob:, and filesystem:, set the "match_origin_as_fallback" to true. For details, see Inject in related frames

By default, content scripts are injected when the document and all resources are finished loading, and live in a private isolated execution environment that isn't accessible to the page or other extensions. You can change these defaults in the following keys:

See the Run on every page tutorial to build an extension that injects a content script in the manifest.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-08-10 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
 "name": "My extension",
 ...
 "content_scripts": [
   {
     "matches": ["https://*.example.com/*"],
     "css": ["my-styles.css"],
     "js": ["content-script.js"],
     "exclude_matches": ["*://*/*foo*"],
     "include_globs": ["*example.com/???s/*"],
     "exclude_globs": ["*bar*"],
     "all_frames": false,
     "match_origin_as_fallback": false,
     "match_about_blank": false,
     "run_at": "document_idle",
     "world": "ISOLATED",
   }
 ],
 ...
}
```

Example 2 (unknown):
```unknown
{
  ...
  "content_scripts": [
    {
      "matches": ["https://*.example.com/*"],
      "include_globs": ["https://???.example.com/foo/*"],
      "js": ["content-script.js"]
    }
  ],
  ...
}
```

Example 3 (unknown):
```unknown
{
  ...
  "content_scripts": [
    {
      "matches": ["https://*.example.com/*"],
      "include_globs": ["*example.com/???s/*"],
      "js": ["content-script.js"]
    }
  ],
  ...
}
```

Example 4 (unknown):
```unknown
{
  ...
  "content_scripts": [
    {
      "matches": ["https://*.example.com/*"],
      "exclude_globs": ["*science*"],
      "js": ["content-script.js"]
    }
  ],
  ...
}
```

---

## Manifest - name Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/name

**Contents:**
- Manifest - name Stay organized with collections Save and categorize content based on your preferences.

The "name" key (required) is a short, plain text string (maximum of 75 characters) that identifies the extension. For example:

You can specify a locale-specific string; see Internationalization for details.

It is displayed in the following locations:

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-05-12 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension name"
}
```

---

## chrome.permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/permissions#step-2-declare-optional-permissions-in-the-manifest

**Contents:**
- chrome.permissions Stay organized with collections Save and categorize content based on your preferences.
- Description
- Concepts and usage
  - Implement optional permissions
    - Step 1: Decide which permissions are required and which are optional
    - Step 2: Declare optional permissions in the manifest
    - Step 3: Request optional permissions
    - Step 4: Check the extension's current permissions
    - Step 5: Remove the permissions
- Types

Description Use the chrome.permissions API to request declared optional permissions at run time rather than install time, so users understand why the permissions are needed and grant only those that are necessary.

Use the chrome.permissions API to request declared optional permissions at run time rather than install time, so users understand why the permissions are needed and grant only those that are necessary.

Permission warnings exist to describe the capabilities granted by an API, but some of these warnings may not be obvious. The Permissions API allows developers to explain permission warnings and introduce new features gradually which gives users a risk-free introduction to the extension. This way, users can specify how much access they are willing to grant and which features they want to enable.

For example, the optional permissions extension's core functionality is overriding the new tab page. One feature is displaying the user's goal of the day. This feature only requires the storage permission, which does not include a warning. The extension has an additional feature, that users can enable by clicking the following button:

Displaying the user's top sites requires the topSites permission, which has the following warning.

An extension can declare both required and optional permissions. In general, you should:

Advantages of required permissions:

Advantages of optional permissions:

Declare optional permissions in your extension manifest with the optional_permissions key, using the same format as the permissions field:

If you want to request hosts that you only discover at runtime, include "https://*/*" in your extension's optional_host_permissions field. This lets you specify any origin in "Permissions.origins" as long as it has a matching scheme.

Permissions that can not be specified as optional

Most Chrome extension permissions can be specified as optional, with the following exceptions.

View Declare Permissions for further information on available permissions and their warnings.

Request the permissions from within a user gesture using permissions.request():

Chrome prompts the user if adding the permissions results in different warning messages than the user has already seen and accepted. For example, the previous code might result in a prompt like this:

To check whether your extension has a specific permission or set of permissions, use permission.contains():

You should remove permissions when you no longer need them. After a permi

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "optional_permissions": ["tabs"],
  "optional_host_permissions": ["https://www.google.com/"],
  ...
}
```

Example 2 (javascript):
```javascript
document.querySelector('#my-button').addEventListener('click', (event) => {
  // Permissions must be requested from inside a user gesture, like a button's
  // click handler.
  chrome.permissions.request({
    permissions: ['tabs'],
    origins: ['https://www.google.com/']
  }, (granted) => {
    // The callback argument will be true if the user granted the permissions.
    if (granted) {
      doSomething();
    } else {
      doSomethingElse();
    }
  });
});
```

Example 3 (javascript):
```javascript
chrome.permissions.contains({
  permissions: ['tabs'],
  origins: ['https://www.google.com/']
}, (result) => {
  if (result) {
    // The extension has the permissions.
  } else {
    // The extension doesn't have the permissions.
  }
});
```

Example 4 (javascript):
```javascript
chrome.permissions.remove({
  permissions: ['tabs'],
  origins: ['https://www.google.com/']
}, (removed) => {
  if (removed) {
    // The permissions have been removed.
  } else {
    // The permissions have not been removed (e.g., you tried to remove
    // required permissions).
  }
});
```

---

## Shared modules Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/shared-modules#import

**Contents:**
- Shared modules Stay organized with collections Save and categorize content based on your preferences.
- Manifest
  - Export
  - Import
- Accessing resources
- Install / uninstall

Shared Modules are permissionless collections of resources that can be shared between extensions. Common uses of Shared Modules are:

Shared Modules are used through two manifest fields: "export" and "import".

The export field indicates an extension is a Shared Module that exports its resources:

The import field is used by extensions and apps to declare that they depend on the resources from particular Shared Modules:

Shared Module resources are accessed by a reserved path _modules/SHARED_MODULE_ID in the root of your importing extension. For example, to include the script foo.js from a Shared Module with ID "cccccccccccccccccccccccccccccccc", use this path from the root of your extension:

If the importing extension has ID "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", then the full URL to resources in the Shared Module is:

Note that since resources from Shared Modules are overlaid into the origin of the importing extension, all privileges granted to the importing extension are available to code in Shared Modules. Also, the Shared Module can access resources in the importing extension by using absolute paths.

A Shared Module is automatically installed from the Chrome Web Store when needed by a dependent extension and automatically uninstalled when the last extension which references it is uninstalled. To upload an extension that uses a Shared Module, the Shared Module must be published in the Chrome Web Store and the extension must not be restricted from using the Shared Module by its allowlist.

During development, you will need to manually install any Shared Modules your extension uses. Automatic installs do not happen for extensions that are side-loaded or loaded as unpacked extensions. For locally installed, unpacked Shared Modules, you must use the key field to ensure the Shared Modules use the correct IDs.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2015-01-05 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "version": "1.0",
  "name": "My Shared Module",
  "export": {
    // Optional list of extension IDs explicitly allowed to
    // import this Shared Module's resources.  If no allowlist
    // is given, all extensions are allowed to import it.
    "allowlist": [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    ]
  }
  // Note: no permissions are allowed in Shared Modules
}
```

Example 2 (unknown):
```unknown
{
  "version": "1.0",
  "name": "My Importing Extension",
  ...
  "import": [
    {"id": "cccccccccccccccccccccccccccccccc"},
    {"id": "dddddddddddddddddddddddddddddddd"
     "minimum_version": "0.5" // optional
    },
  ]
}
```

Example 3 (unknown):
```unknown
<script src="_modules/cccccccccccccccccccccccccccccccc/foo.js">
```

Example 4 (unknown):
```unknown
chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/_modules/cccccccccccccccccccccccccccccccc/
```

---

## Manifest Version Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/manifest/manifest-version

**Contents:**
- Manifest Version Stay organized with collections Save and categorize content based on your preferences.

An integer specifying the version of the manifest file format your package requires. This key is required. For example:

Supported values for this key are:

The current version is Manifest V3. The Chrome Web Store no longer accepts manifest V2 extensions (see Manifest V2 support timeline for more details). There will be other manifest versions in the future (V4 and beyond), but these aren't scheduled yet.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2013-05-12 UTC.

**Examples:**

Example 1 (unknown):
```unknown
"manifest_version": 3
```

---
