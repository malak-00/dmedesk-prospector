# Chrome-Extension - Background Scripts

**Pages:** 6

---

## About extension service workers Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/service_workers

**Contents:**
- About extension service workers Stay organized with collections Save and categorize content based on your preferences.

This section explains what you need to know to use service workers in extensions. You should read this section whether you're familiar with service workers or not. Extension service workers are an extension's central event handler. That makes them just different enough from web service workers that the mountains of service worker articles around the web may or may not be useful.

Extension service workers have a few things in common with their web counterparts. An extension service worker is loaded when it is needed, and unloaded when it goes dormant. Once loaded, an extension service worker generally runs as long as it is actively receiving events, though it can shut down. Like its web counterpart, an extension service worker cannot access the DOM, though you can use it if needed with offscreen documents.

Extension service workers are more than network proxies (as web service workers are often described). In addition to the standard service worker events, they also respond to extension events such as navigating to a new page, clicking a notification, or closing a tab. They're also registered and updated differently from web service workers.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-05-03 UTC.

---

## The extension service worker lifecycle Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#idle-shutdown

**Contents:**
- The extension service worker lifecycle Stay organized with collections Save and categorize content based on your preferences.
- Installation
  - ServiceWorkerRegistration.install
  - chrome.runtime.onInstalled
  - ServiceWorkerRegistration.active
- Extension startup
- Idle and shutdown
  - Persist data rather than using global variables
  - Choose a minimum Chrome version
    - Chrome 120

Extension service workers respond to both the standard service worker events and to events in extension namespaces. They are presented together because often one type follows another during an extension's use.

Installation occurs when the user installs or updates a service worker from the Chrome Web Store or when they load or update an unpacked extension using the chrome://extensions page. Three events occur, in this order:

The first event fired during installation is a web service worker's install event.

Next is the extension's onInstalled event, which is fired when the extension (not the service worker) is first installed, when the extension is updated to a new version, and when Chrome is updated to a new version. Use this event to set a state or for one-time initialization, such as a context menu.

Finally, the service worker's activate event is fired. Note that unlike web service workers, this event is fired immediately after installation of an extension because there is nothing comparable to a page reload in an extension.

When a user profile starts, the chrome.runtime.onStartup event fires but no service worker events are invoked.

Normally, Chrome terminates a service worker when one of the following conditions is met:

Events and calls to extension APIs reset these timers, and if the service worker has gone dormant, an incoming event will revive them. Nevertheless, you should design your service worker to be resilient against unexpected termination.

To optimize the resource consumption of your extension, avoid keeping your service worker alive indefinitely if possible. Test your extensions to ensure that you're not doing this unintentionally.

Any global variables you set will be lost if the service worker shuts down. Instead of using global variables, save values to storage. Your options are listed.

Since the release of Manifest V3, we've made several improvements to service worker lifetimes. This means that if your Manifest V3 extension supports earlier versions of Chrome, there are conditions you will need to be aware of. If these conditions don't affect your extension, you can move on from this section. If they do, consider specifying a minimum Chrome version in your manifest.

Alarms can now be set to a minimum period of 30s to match the service worker lifecycle. See chrome.alarms for more details.

Active debugger sessions created using the chrome.debugger API now keep the service worker alive. This prevents service workers from timing o

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
chrome.runtime.onInstalled.addListener((details) => {
  if(details.reason !== "install" && details.reason !== "update") return;
  chrome.contextMenus.create({
    "id": "sampleContextMenu",
    "title": "Sample Context Menu",
    "contexts": ["selection"]
  });
});
```

---

## The extension service worker lifecycle Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

**Contents:**
- The extension service worker lifecycle Stay organized with collections Save and categorize content based on your preferences.
- Installation
  - ServiceWorkerRegistration.install
  - chrome.runtime.onInstalled
  - ServiceWorkerRegistration.active
- Extension startup
- Idle and shutdown
  - Persist data rather than using global variables
  - Choose a minimum Chrome version
    - Chrome 120

Extension service workers respond to both the standard service worker events and to events in extension namespaces. They are presented together because often one type follows another during an extension's use.

Installation occurs when the user installs or updates a service worker from the Chrome Web Store or when they load or update an unpacked extension using the chrome://extensions page. Three events occur, in this order:

The first event fired during installation is a web service worker's install event.

Next is the extension's onInstalled event, which is fired when the extension (not the service worker) is first installed, when the extension is updated to a new version, and when Chrome is updated to a new version. Use this event to set a state or for one-time initialization, such as a context menu.

Finally, the service worker's activate event is fired. Note that unlike web service workers, this event is fired immediately after installation of an extension because there is nothing comparable to a page reload in an extension.

When a user profile starts, the chrome.runtime.onStartup event fires but no service worker events are invoked.

Normally, Chrome terminates a service worker when one of the following conditions is met:

Events and calls to extension APIs reset these timers, and if the service worker has gone dormant, an incoming event will revive them. Nevertheless, you should design your service worker to be resilient against unexpected termination.

To optimize the resource consumption of your extension, avoid keeping your service worker alive indefinitely if possible. Test your extensions to ensure that you're not doing this unintentionally.

Any global variables you set will be lost if the service worker shuts down. Instead of using global variables, save values to storage. Your options are listed.

Since the release of Manifest V3, we've made several improvements to service worker lifetimes. This means that if your Manifest V3 extension supports earlier versions of Chrome, there are conditions you will need to be aware of. If these conditions don't affect your extension, you can move on from this section. If they do, consider specifying a minimum Chrome version in your manifest.

Alarms can now be set to a minimum period of 30s to match the service worker lifecycle. See chrome.alarms for more details.

Active debugger sessions created using the chrome.debugger API now keep the service worker alive. This prevents service workers from timing o

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
chrome.runtime.onInstalled.addListener((details) => {
  if(details.reason !== "install" && details.reason !== "update") return;
  chrome.contextMenus.create({
    "id": "sampleContextMenu",
    "title": "Sample Context Menu",
    "contexts": ["selection"]
  });
});
```

---

## chrome.action Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/action#method-setBadgeBackgroundColor

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

## About extension service workers Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/concepts/service-workers

**Contents:**
- About extension service workers Stay organized with collections Save and categorize content based on your preferences.

This section explains what you need to know to use service workers in extensions. You should read this section whether you're familiar with service workers or not. Extension service workers are an extension's central event handler. That makes them just different enough from web service workers that the mountains of service worker articles around the web may or may not be useful.

Extension service workers have a few things in common with their web counterparts. An extension service worker is loaded when it is needed, and unloaded when it goes dormant. Once loaded, an extension service worker generally runs as long as it is actively receiving events, though it can shut down. Like its web counterpart, an extension service worker cannot access the DOM, though you can use it if needed with offscreen documents.

Extension service workers are more than network proxies (as web service workers are often described). In addition to the standard service worker events, they also respond to extension events such as navigating to a new page, clicking a notification, or closing a tab. They're also registered and updated differently from web service workers.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-05-03 UTC.

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#background

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---
