# Chrome-Extension - User Interface

**Pages:** 15

---

## User interface components Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/user_interface#tooltips

**Contents:**
- User interface components Stay organized with collections Save and categorize content based on your preferences.
- Actions
- Action icons
- Badges
- Commands
- Context menu
- Omnibox
- Override pages
- Popups
- Side panels

This is a catalog of user interface elements available in extensions. Each entry contains:

These elements are different ways of invoking extension features. You're not required to implement all of them. In fact, some use cases might not use any of them. For example, a link shorter could act on the displayed URL using a keyboard shortcut and put the shortened link into the clipboard programmatically.

An action is what happens when a user clicks the action icon for your extension. An action can either invoke an extension feature using the Action API or open a popup that lets users invoke multiple extension features. Tell users what the action does using a tooltip.

To learn to build an action, see Implement an action, or examine the action samples.

An extension requires at least one icon to represent it. Users click the icon to invoke an action, whether that action invokes an extension feature using the Action API or opens a popup.

You can also add a label, here called a 'badge', to the icon to communicate such things as extension state or that actions are required by the user.

To learn to build an action, see Implement an action, or examine the action samples.

Badges are bits of formatted text placed on top of the action icon to indicate such things as extension state or that actions are required by the user. You can set the text of the badge by calling chrome.action.setBadgeText() and the banner color by calling chrome.action.setBadgeBackgroundColor().

To learn to build an action, see Implement an action, or the Drink water sample.

Commands are key combinations that invoke an extension feature. Define key combinations in the manifest.json file and respond to them using the Commands API. To learn to implement a command, see the API reference, or the chrome.commands sample.

A context menu appears for the alternate click (frequently called the right click) of a mouse. Define context menus using the Context Menus API.

To learn to implement a context menu, see the context menu samples.

You can interact with users using the Chrome omnibox. When a user enters extension-defined keywords in the omnibox, your extension controls what the user sees in the omnibox. Define keywords in the manifest.json and respond to them using the Omnibox API.

To learn to override the omnibox, see Trigger actions from the omnibox, or the quick API reference sample.

An extension can override one of these built-in Chrome pages:

To learn to override Chrome pages, see Overrid

*[Content truncated]*

---

## chrome.action Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/action#method-setBadgeText

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

## User interface components Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/user_interface

**Contents:**
- User interface components Stay organized with collections Save and categorize content based on your preferences.
- Actions
- Action icons
- Badges
- Commands
- Context menu
- Omnibox
- Override pages
- Popups
- Side panels

This is a catalog of user interface elements available in extensions. Each entry contains:

These elements are different ways of invoking extension features. You're not required to implement all of them. In fact, some use cases might not use any of them. For example, a link shorter could act on the displayed URL using a keyboard shortcut and put the shortened link into the clipboard programmatically.

An action is what happens when a user clicks the action icon for your extension. An action can either invoke an extension feature using the Action API or open a popup that lets users invoke multiple extension features. Tell users what the action does using a tooltip.

To learn to build an action, see Implement an action, or examine the action samples.

An extension requires at least one icon to represent it. Users click the icon to invoke an action, whether that action invokes an extension feature using the Action API or opens a popup.

You can also add a label, here called a 'badge', to the icon to communicate such things as extension state or that actions are required by the user.

To learn to build an action, see Implement an action, or examine the action samples.

Badges are bits of formatted text placed on top of the action icon to indicate such things as extension state or that actions are required by the user. You can set the text of the badge by calling chrome.action.setBadgeText() and the banner color by calling chrome.action.setBadgeBackgroundColor().

To learn to build an action, see Implement an action, or the Drink water sample.

Commands are key combinations that invoke an extension feature. Define key combinations in the manifest.json file and respond to them using the Commands API. To learn to implement a command, see the API reference, or the chrome.commands sample.

A context menu appears for the alternate click (frequently called the right click) of a mouse. Define context menus using the Context Menus API.

To learn to implement a context menu, see the context menu samples.

You can interact with users using the Chrome omnibox. When a user enters extension-defined keywords in the omnibox, your extension controls what the user sees in the omnibox. Define keywords in the manifest.json and respond to them using the Omnibox API.

To learn to override the omnibox, see Trigger actions from the omnibox, or the quick API reference sample.

An extension can override one of these built-in Chrome pages:

To learn to override Chrome pages, see Overrid

*[Content truncated]*

---

## User interface components Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/user_interface#popups

**Contents:**
- User interface components Stay organized with collections Save and categorize content based on your preferences.
- Actions
- Action icons
- Badges
- Commands
- Context menu
- Omnibox
- Override pages
- Popups
- Side panels

This is a catalog of user interface elements available in extensions. Each entry contains:

These elements are different ways of invoking extension features. You're not required to implement all of them. In fact, some use cases might not use any of them. For example, a link shorter could act on the displayed URL using a keyboard shortcut and put the shortened link into the clipboard programmatically.

An action is what happens when a user clicks the action icon for your extension. An action can either invoke an extension feature using the Action API or open a popup that lets users invoke multiple extension features. Tell users what the action does using a tooltip.

To learn to build an action, see Implement an action, or examine the action samples.

An extension requires at least one icon to represent it. Users click the icon to invoke an action, whether that action invokes an extension feature using the Action API or opens a popup.

You can also add a label, here called a 'badge', to the icon to communicate such things as extension state or that actions are required by the user.

To learn to build an action, see Implement an action, or examine the action samples.

Badges are bits of formatted text placed on top of the action icon to indicate such things as extension state or that actions are required by the user. You can set the text of the badge by calling chrome.action.setBadgeText() and the banner color by calling chrome.action.setBadgeBackgroundColor().

To learn to build an action, see Implement an action, or the Drink water sample.

Commands are key combinations that invoke an extension feature. Define key combinations in the manifest.json file and respond to them using the Commands API. To learn to implement a command, see the API reference, or the chrome.commands sample.

A context menu appears for the alternate click (frequently called the right click) of a mouse. Define context menus using the Context Menus API.

To learn to implement a context menu, see the context menu samples.

You can interact with users using the Chrome omnibox. When a user enters extension-defined keywords in the omnibox, your extension controls what the user sees in the omnibox. Define keywords in the manifest.json and respond to them using the Omnibox API.

To learn to override the omnibox, see Trigger actions from the omnibox, or the quick API reference sample.

An extension can override one of these built-in Chrome pages:

To learn to override Chrome pages, see Overrid

*[Content truncated]*

---

## chrome.action Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/action#event-onClicked

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

## 

**URL:** https://developer.chrome.com/docs/extensions/ai#ai-powered-extensions-in-action

**Contents:**
  - Extensions and AI
  - Enhance browsing with AI-powered extensions
    - Control web content
    - Make the browser more helpful
    - Customize the browser
  - Build AI-powered Chrome Extensions with Gemini
  - Even more use cases
- Integrate AI with extensions
  - Client-side AI
  - Cloud AI

---

## User interface components Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/user_interface#action-icons

**Contents:**
- User interface components Stay organized with collections Save and categorize content based on your preferences.
- Actions
- Action icons
- Badges
- Commands
- Context menu
- Omnibox
- Override pages
- Popups
- Side panels

This is a catalog of user interface elements available in extensions. Each entry contains:

These elements are different ways of invoking extension features. You're not required to implement all of them. In fact, some use cases might not use any of them. For example, a link shorter could act on the displayed URL using a keyboard shortcut and put the shortened link into the clipboard programmatically.

An action is what happens when a user clicks the action icon for your extension. An action can either invoke an extension feature using the Action API or open a popup that lets users invoke multiple extension features. Tell users what the action does using a tooltip.

To learn to build an action, see Implement an action, or examine the action samples.

An extension requires at least one icon to represent it. Users click the icon to invoke an action, whether that action invokes an extension feature using the Action API or opens a popup.

You can also add a label, here called a 'badge', to the icon to communicate such things as extension state or that actions are required by the user.

To learn to build an action, see Implement an action, or examine the action samples.

Badges are bits of formatted text placed on top of the action icon to indicate such things as extension state or that actions are required by the user. You can set the text of the badge by calling chrome.action.setBadgeText() and the banner color by calling chrome.action.setBadgeBackgroundColor().

To learn to build an action, see Implement an action, or the Drink water sample.

Commands are key combinations that invoke an extension feature. Define key combinations in the manifest.json file and respond to them using the Commands API. To learn to implement a command, see the API reference, or the chrome.commands sample.

A context menu appears for the alternate click (frequently called the right click) of a mouse. Define context menus using the Context Menus API.

To learn to implement a context menu, see the context menu samples.

You can interact with users using the Chrome omnibox. When a user enters extension-defined keywords in the omnibox, your extension controls what the user sees in the omnibox. Define keywords in the manifest.json and respond to them using the Omnibox API.

To learn to override the omnibox, see Trigger actions from the omnibox, or the quick API reference sample.

An extension can override one of these built-in Chrome pages:

To learn to override Chrome pages, see Overrid

*[Content truncated]*

---

## chrome.action Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/action#event-onUserSettingsChanged

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

## Give users options Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/ui/options-page

**Contents:**
- Give users options Stay organized with collections Save and categorize content based on your preferences.
- Locating the options page
- Write the options page
- Declare options page behavior
  - Full page options
  - Embedded options
- Consider the differences
  - Link to the options page
  - Tabs API
  - Messaging APIs

Just as extensions allow users to customize the Chrome browser, the options page enables customization of the extension. Use options to enable features and allow users to choose what functionality is relevant to their needs.

Users can access the options page by direct link or by right-clicking the extension icon in the toolbar and then selecting options. Additionally, users can navigate to the options page by, first, opening chrome://extensions, locating the desired extension, clicking Details, and then selecting the options link.

The following is an example of an options page:

Below is an example options script. Save it in the same folder as options.html. This saves the user's preferred options across devices using the storage.sync API.

Finally, add the "storage" permission to the extension's manifest file:

There are two types of extension options pages, full page and embedded. The type of options page is determined by how it is declared in the manifest.

A full page options page is displayed in a new tab. Register the options HTML file in the manifest in the "options_page" field.

An embedded options page allows users to adjust extension options without navigating away from the extensions management page inside an embedded box. To declare embedded options, register the HTML file under the "options_ui" field in the extension manifest, with the "open_in_tab" key set to false.

Options pages embedded inside chrome://extensions have subtle behavior differences from options pages in tabs.

An extension can link directly to the options page by calling chrome.runtime.openOptionsPage(). For example, it can be added to a popup:

Because embedded options code is not hosted in a tab, the Tabs API cannot be used. Use runtime.connect() and runtime.sendMessage() instead, if the options page does need to manipulate the containing tab.

If an extension's options page sends a message using runtime.connect() or runtime.sendMessage(), the sender's tab will not be set, and the sender's URL will be the options page URL.

The embedded options should automatically determine their own size based on the page content. However, the embedded box may not find a good size for some types of content. This problem is most common for options pages that adjust their content shape based on window size.

If this is an issue, provide fixed minimum dimensions for the options page to ensure that the embedded page will find an appropriate size.

Except as otherwise noted, the content of th

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
<!DOCTYPE html>
<html>
  <head>
    <title>My Test Extension Options</title>
  </head>
  <body>
    <select id="color">
      <option value="red">red</option>
      <option value="green">green</option>
      <option value="blue">blue</option>
      <option value="yellow">yellow</option>
    </select>

    <label>
      <input type="checkbox" id="like" />
      I like colors.
    </label>

    <div id="status"></div>
    <button id="save">Save</button>

    <script src="options.js"></script>
  </body>
</html>
```

Example 2 (javascript):
```javascript
// Saves options to chrome.storage
const saveOptions = () => {
  const color = document.getElementById('color').value;
  const likesColor = document.getElementById('like').checked;

  chrome.storage.sync.set(
    { favoriteColor: color, likesColor: likesColor },
    () => {
      // Update status to let user know options were saved.
      const status = document.getElementById('status');
      status.textContent = 'Options saved.';
      setTimeout(() => {
        status.textContent = '';
      }, 750);
    }
  );
};

// Restores select box and checkbox state using the preferences
// stored in
...
```

Example 3 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "storage"
  ]
  ...
}
```

Example 4 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "options_page": "options.html",
  ...
}
```

---

## Add a popup Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/ui/add-popup

**Contents:**
- Add a popup Stay organized with collections Save and categorize content based on your preferences.

A popup is an action that displays a window letting users invoke multiple extension features. It's triggered by a keyboard shortcut, by clicking the extension's action icon or by calling chrome.action.openPopup(). Popups automatically close when the user focuses on some portion of the browser outside of the popup. There is no way to keep the popup open after the user has clicked away.

The following image, taken from the Drink Water Event sample, shows a popup displaying available timer options. Users set an alarm by clicking one of the buttons.

Register a popup in the manifest under the "action" key.

Implement the popup as you would almost any other web page. Note that any JavaScript used in a popup must be in a separate file.

You can also create popups dynamically by calling action.setPopup().

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-12-12 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
 "name": "Drink Water Event",
 ...
 "action": {
   "default_popup": "popup.html"
 }
 ...
}
```

Example 2 (unknown):
```unknown
<html>
 <head>
   <title>Water Popup</title>
 </head>
 <body>
     <img src="./stay_hydrated.png" id="hydrateImage">
     <button id="sampleSecond" value="0.1">Sample Second</button>
     <button id="min15" value="15">15 Minutes</button>
     <button id="min30" value="30">30 Minutes</button>
     <button id="cancelAlarm">Cancel Alarm</button>
   <script src="popup.js"></script>
 </body>
</html>
```

Example 3 (javascript):
```javascript
chrome.storage.local.get('signed_in', (data) => {
  if (data.signed_in) {
    chrome.action.setPopup({popup: 'popup.html'});
  } else {
    chrome.action.setPopup({popup: 'popup_sign_in.html'});
  }
});
```

---

## chrome.action Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/action#concepts_and_usage

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

## chrome.action Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/action

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

## Give users options Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/ui/options-page#embedded_options

**Contents:**
- Give users options Stay organized with collections Save and categorize content based on your preferences.
- Locating the options page
- Write the options page
- Declare options page behavior
  - Full page options
  - Embedded options
- Consider the differences
  - Link to the options page
  - Tabs API
  - Messaging APIs

Just as extensions allow users to customize the Chrome browser, the options page enables customization of the extension. Use options to enable features and allow users to choose what functionality is relevant to their needs.

Users can access the options page by direct link or by right-clicking the extension icon in the toolbar and then selecting options. Additionally, users can navigate to the options page by, first, opening chrome://extensions, locating the desired extension, clicking Details, and then selecting the options link.

The following is an example of an options page:

Below is an example options script. Save it in the same folder as options.html. This saves the user's preferred options across devices using the storage.sync API.

Finally, add the "storage" permission to the extension's manifest file:

There are two types of extension options pages, full page and embedded. The type of options page is determined by how it is declared in the manifest.

A full page options page is displayed in a new tab. Register the options HTML file in the manifest in the "options_page" field.

An embedded options page allows users to adjust extension options without navigating away from the extensions management page inside an embedded box. To declare embedded options, register the HTML file under the "options_ui" field in the extension manifest, with the "open_in_tab" key set to false.

Options pages embedded inside chrome://extensions have subtle behavior differences from options pages in tabs.

An extension can link directly to the options page by calling chrome.runtime.openOptionsPage(). For example, it can be added to a popup:

Because embedded options code is not hosted in a tab, the Tabs API cannot be used. Use runtime.connect() and runtime.sendMessage() instead, if the options page does need to manipulate the containing tab.

If an extension's options page sends a message using runtime.connect() or runtime.sendMessage(), the sender's tab will not be set, and the sender's URL will be the options page URL.

The embedded options should automatically determine their own size based on the page content. However, the embedded box may not find a good size for some types of content. This problem is most common for options pages that adjust their content shape based on window size.

If this is an issue, provide fixed minimum dimensions for the options page to ensure that the embedded page will find an appropriate size.

Except as otherwise noted, the content of th

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
<!DOCTYPE html>
<html>
  <head>
    <title>My Test Extension Options</title>
  </head>
  <body>
    <select id="color">
      <option value="red">red</option>
      <option value="green">green</option>
      <option value="blue">blue</option>
      <option value="yellow">yellow</option>
    </select>

    <label>
      <input type="checkbox" id="like" />
      I like colors.
    </label>

    <div id="status"></div>
    <button id="save">Save</button>

    <script src="options.js"></script>
  </body>
</html>
```

Example 2 (javascript):
```javascript
// Saves options to chrome.storage
const saveOptions = () => {
  const color = document.getElementById('color').value;
  const likesColor = document.getElementById('like').checked;

  chrome.storage.sync.set(
    { favoriteColor: color, likesColor: likesColor },
    () => {
      // Update status to let user know options were saved.
      const status = document.getElementById('status');
      status.textContent = 'Options saved.';
      setTimeout(() => {
        status.textContent = '';
      }, 750);
    }
  );
};

// Restores select box and checkbox state using the preferences
// stored in
...
```

Example 3 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "storage"
  ]
  ...
}
```

Example 4 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "options_page": "options.html",
  ...
}
```

---

## User interface components Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/user_interface#actions

**Contents:**
- User interface components Stay organized with collections Save and categorize content based on your preferences.
- Actions
- Action icons
- Badges
- Commands
- Context menu
- Omnibox
- Override pages
- Popups
- Side panels

This is a catalog of user interface elements available in extensions. Each entry contains:

These elements are different ways of invoking extension features. You're not required to implement all of them. In fact, some use cases might not use any of them. For example, a link shorter could act on the displayed URL using a keyboard shortcut and put the shortened link into the clipboard programmatically.

An action is what happens when a user clicks the action icon for your extension. An action can either invoke an extension feature using the Action API or open a popup that lets users invoke multiple extension features. Tell users what the action does using a tooltip.

To learn to build an action, see Implement an action, or examine the action samples.

An extension requires at least one icon to represent it. Users click the icon to invoke an action, whether that action invokes an extension feature using the Action API or opens a popup.

You can also add a label, here called a 'badge', to the icon to communicate such things as extension state or that actions are required by the user.

To learn to build an action, see Implement an action, or examine the action samples.

Badges are bits of formatted text placed on top of the action icon to indicate such things as extension state or that actions are required by the user. You can set the text of the badge by calling chrome.action.setBadgeText() and the banner color by calling chrome.action.setBadgeBackgroundColor().

To learn to build an action, see Implement an action, or the Drink water sample.

Commands are key combinations that invoke an extension feature. Define key combinations in the manifest.json file and respond to them using the Commands API. To learn to implement a command, see the API reference, or the chrome.commands sample.

A context menu appears for the alternate click (frequently called the right click) of a mouse. Define context menus using the Context Menus API.

To learn to implement a context menu, see the context menu samples.

You can interact with users using the Chrome omnibox. When a user enters extension-defined keywords in the omnibox, your extension controls what the user sees in the omnibox. Define keywords in the manifest.json and respond to them using the Omnibox API.

To learn to override the omnibox, see Trigger actions from the omnibox, or the quick API reference sample.

An extension can override one of these built-in Chrome pages:

To learn to override Chrome pages, see Overrid

*[Content truncated]*

---

## chrome.action Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup

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
