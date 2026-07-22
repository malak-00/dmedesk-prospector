# Chrome-Extension - Apis

**Pages:** 88

---

## chrome.devtools.panels Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/devtools/panels

**Contents:**
- chrome.devtools.panels Stay organized with collections Save and categorize content based on your preferences.
- Description
- Manifest
- Example
- Types
  - Button
    - Properties
  - ElementsPanel
    - Properties
  - ExtensionPanel

Description Use the chrome.devtools.panels API to integrate your extension into Developer Tools window UI: create your own panels, access existing panels, and add sidebars.

Use the chrome.devtools.panels API to integrate your extension into Developer Tools window UI: create your own panels, access existing panels, and add sidebars.

Each extension panel and sidebar is displayed as a separate HTML page. All extension pages displayed in the Developer Tools window have access to all parts of the chrome.devtools API, as well as all other extension APIs.

You can use the devtools.panels.setOpenResourceHandler method to install a callback function that handles user requests to open a resource (typically, a click a resource link in the Developer Tools window). At most one of the installed handlers gets called; users can specify (using the Developer Tools Settings dialog) either the default behavior or an extension to handle resource open requests. If an extension calls setOpenResourceHandler() multiple times, only the last handler is retained.

See DevTools APIs summary for general introduction to using Developer Tools APIs.

Manifest The following keys must be declared in the manifest to use this API."devtools_page"

The following keys must be declared in the manifest to use this API.

The following code adds a panel contained in Panel.html, represented by FontPicker.png on the Developer Tools toolbar and labeled as Font Picker:

The following code adds a sidebar pane contained in Sidebar.html and titled Font Properties to the Elements panel, then sets its height to 8ex:

The screenshot illustrates the effect this example would have on Developer Tools window:

To try this API, install the devtools panels API example from the chrome-extension-samples repository.

Types Button A button created by the extension. Properties onClicked Event<functionvoidvoid> Fired when the button is clicked. The onClicked.addListener function looks like: (callback: function) => {...} callback function The callback parameter looks like: () => void update void Updates the attributes of the button. If some of the arguments are omitted or null, the corresponding attributes are not updated. The update function looks like: (iconPath?: string, tooltipText?: string, disabled?: boolean) => {...} iconPath string optional Path to the new icon of the button. tooltipText string optional Text shown as a tooltip when user hovers the mouse over the button. disabled boolean optional Whether the butt

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
chrome.devtools.panels.create("Font Picker",
                              "FontPicker.png",
                              "Panel.html",
                              function(panel) { ... });
```

Example 2 (unknown):
```unknown
chrome.devtools.panels.elements.createSidebarPane("Font Properties",
  function(sidebar) {
    sidebar.setPage("Sidebar.html");
    sidebar.setHeight("8ex");
  }
);
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## chrome.tabs Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/tabs#property-Tab-frozen

**Contents:**
- chrome.tabs Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Use cases
  - Open an extension page in a new tab
  - Get the current tab
  - Mute the specified tab
  - Move the current tab to the first position when clicked
  - Pass a message to a selected tab's content script
- Extension examples

Description Use the chrome.tabs API to interact with the browser's tab system. You can use this API to create, modify, and rearrange tabs in the browser.

Use the chrome.tabs API to interact with the browser's tab system. You can use this API to create, modify, and rearrange tabs in the browser.

The Tabs API not only offers features for manipulating and managing tabs, but can also detect the language of the tab, take a screenshot, and communicate with a tab's content scripts.

Most features don't require any permissions to use. For example: creating a new tab, reloading a tab, navigating to another URL, etc.

There are three permissions developers should be aware of when working with the Tabs API.

This permission does not give access to the chrome.tabs namespace. Instead, it grants an extension the ability to call tabs.query() against four sensitive properties on tabs.Tab instances: url, pendingUrl, title, and favIconUrl.

Host permissions allow an extension to read and query a matching tab's four sensitive tabs.Tab properties. They can also interact directly with the matching tabs using methods such as tabs.captureVisibleTab(), scripting.executeScript(), scripting.insertCSS(), and scripting.removeCSS().

activeTab grants an extension temporary host permission for the current tab in response to a user invocation. Unlike host permissions, activeTab does not trigger any warnings.

The following sections demonstrate some common use cases.

A common pattern for extensions is to open an onboarding page in a new tab when the extension is installed. The following example shows how to do this.

This example demonstrates how an extension's service worker can retrieve the active tab from the currently-focused window (or most recently-focused window, if no Chrome windows are focused). This can usually be thought of as the user's current tab.

This example shows how an extension can toggle the muted state for a given tab.

This example shows how to move a tab while a drag may or may not be in progress. While this example uses chrome.tabs.move, you can use the same waiting pattern for other calls that modify tabs while a drag is in progress.

This example demonstrates how an extension's service worker can communicate with content scripts in specific browser tabs using tabs.sendMessage().

For more Tabs API extensions demos, explore any of the following:

Types MutedInfo Chrome 46+ The tab's muted state and the reason for the last state change. Properties extensionId 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "tabs"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "host_permissions": [
    "http://*/*",
    "https://*/*"
  ],
  ...
}
```

Example 3 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "activeTab"
  ],
  ...
}
```

Example 4 (javascript):
```javascript
chrome.runtime.onInstalled.addListener(({reason}) => {
  if (reason === 'install') {
    chrome.tabs.create({
      url: "onboarding.html"
    });
  }
});
```

---

## chrome.runtime Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/runtime#property-id

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

## chrome.declarativeNetRequest Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#property-RuleCondition-responseHeaders

**Contents:**
- chrome.declarativeNetRequest Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Rules and rulesets
  - Dynamic and session-scoped rulesets
  - Static rulesets
- Expedited review
- Enable and disable static rules and rulesets

Description The chrome.declarativeNetRequest API is used to block or modify network requests by specifying declarative rules. This lets extensions modify network requests without intercepting them and viewing their content, thus providing more privacy.

The chrome.declarativeNetRequest API is used to block or modify network requests by specifying declarative rules. This lets extensions modify network requests without intercepting them and viewing their content, thus providing more privacy.

Permissions declarativeNetRequestdeclarativeNetRequestWithHostAccess

The "declarativeNetRequest" and "declarativeNetRequestWithHostAccess" permissions provide the same capabilities. The differences between them is when permissions are requested or granted.

Availability Chrome 84+

In addition to the permissions described previously, certain types of rulesets, static rulesets specifically, require declaring the "declarative_net_request" manifest key, which should be a dictionary with a single key called "rule_resources". This key is an array containing dictionaries of type Ruleset, as shown in the following. (Note that the name 'Ruleset' does not appear in the manifest's JSON since it is merely an array.) Static rulesets are explained later in this document.

To use this API, specify one or more rulesets. A ruleset contains an array of rules. A single rule does one of the following:

There are three types of rulesets, managed in slightly different ways.

Dynamic and session rulesets are managed using JavaScript while an extension is in use.

There is only one each of these ruleset types. An extension can add or remove rules to them dynamically by calling updateDynamicRules() and updateSessionRules(), provided the rule limits aren't exceeded. For information on rule limits, see Rule limits. You can see an example of this under code examples.

Unlike dynamic and session rules, static rules are packaged, installed, and updated when an extension is installed or upgraded. They're stored in rule files in JSON format, which are indicated to the extension using the "declarative_net_request" and "rule_resources" keys as described above, as well as one or more Ruleset dictionaries. A Ruleset dictionary contains a path to the rule file, an ID for the ruleset contained in the file, and whether the ruleset is enabled or disabled. The last two are important when you enable or disable a ruleset programmatically.

To test rule files, load your extension unpacked. Errors and warnings a

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...

  "declarative_net_request" : {
    "rule_resources" : [{
      "id": "ruleset_1",
      "enabled": true,
      "path": "rules_1.json"
    }, {
      "id": "ruleset_2",
      "enabled": false,
      "path": "rules_2.json"
    }]
  },
  "permissions": [
    "declarativeNetRequest",
    "declarativeNetRequestFeedback"
  ],
  "host_permissions": [
    "http://www.blogger.com/*",
    "http://*.google.com/*"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
{
  ...
  "declarative_net_request" : {
    "rule_resources" : [{
      "id": "ruleset_1",
      "enabled": true,
      "path": "rules_1.json"
    },
    ...
    ]
  }
  ...
}
```

Example 3 (unknown):
```unknown
{
  "id" : 1,
  "priority": 1,
  "action" : { "type" : "block" },
  "condition" : {
    "urlFilter" : "abc",
    "initiatorDomains" : ["foo.com"],
    "resourceTypes" : ["script"]
  }
}
```

Example 4 (unknown):
```unknown
rules_1.json: Rule with id 1 specified a more complex regex than allowed
as part of the "regexFilter" key.
```

---

## chrome.ttsEngine Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/ttsEngine

**Contents:**
- chrome.ttsEngine Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Concepts and usage
  - Handle speech events
- Types
  - AudioBuffer
    - Properties
  - AudioStreamOptions
    - Properties

Description Use the chrome.ttsEngine API to implement a text-to-speech(TTS) engine using an extension. If your extension registers using this API, it will receive events containing an utterance to be spoken and other parameters when any extension or Chrome App uses the tts API to generate speech. Your extension can then use any available web technology to synthesize and output the speech, and send events back to the calling function to report the status.

Use the chrome.ttsEngine API to implement a text-to-speech(TTS) engine using an extension. If your extension registers using this API, it will receive events containing an utterance to be spoken and other parameters when any extension or Chrome App uses the tts API to generate speech. Your extension can then use any available web technology to synthesize and output the speech, and send events back to the calling function to report the status.

Permissions ttsEngine

An extension can register itself as a speech engine. By doing so, it can intercept some or all calls to functions such as tts.speak() and tts.stop() and provide an alternate implementation. Extensions are free to use any available web technology to provide speech, including streaming audio from a server, HTML5 audio. An extension could even do something different with the utterances, like display closed captions in a popup or send them as log messages to a remote server.

To implement a TTS engine, an extension must declare the "ttsEngine" permission and then declare all voices it provides in the extension manifest, like this:

An extension can specify any number of voices.

The voice_name parameter is required. The name should be descriptive enough that it identifies the name of the voice and the engine used. In the unlikely event that two extensions register voices with the same name, a client can specify the ID of the extension that should do the synthesis.

The lang parameter is optional, but highly recommended. Almost always, a voice can synthesize speech in just a single language. When an engine supports more than one language, it can easily register a separate voice for each language. Under rare circumstances where a single voice can handle more than one language, it's easiest to just list two separate voices and handle them using the same logic internally. However, if you want to create a voice that will handle utterances in any language, leave out the lang parameter from your extension's manifest.

Finally, the event_types parameter i

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My TTS Engine",
  "version": "1.0",
  "permissions": ["ttsEngine"],
  "tts_engine": {
    "voices": [
      {
        "voice_name": "Alice",
        "lang": "en-US",
        "event_types": ["start", "marker", "end"]
      },
      {
        "voice_name": "Pat",
        "lang": "en-US",
        "event_types": ["end"]
      }
    ]
  },
  "background": {
    "page": "background.html",
    "persistent": false
  }
}
```

Example 2 (javascript):
```javascript
const speakListener = (utterance, options, sendTtsEvent) => {
  sendTtsEvent({type: 'start', charIndex: 0})

  // (start speaking)

  sendTtsEvent({type: 'end', charIndex: utterance.length})
};

const stopListener = () => {
  // (stop all speech)
};

chrome.ttsEngine.onSpeak.addListener(speakListener);
chrome.ttsEngine.onStop.addListener(stopListener);
```

---

## chrome.runtime Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onConnect

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

## chrome.scripting Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/scripting#type-RegisteredContentScript

**Contents:**
- chrome.scripting Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Concepts and usage
  - Injection targets
  - Injected code
    - Files
    - Runtime functions

Description Use the chrome.scripting API to execute script in different contexts.

Use the chrome.scripting API to execute script in different contexts.

Permissions scripting

Availability Chrome 88+ MV3+

To use the chrome.scripting API, declare the "scripting" permission in the manifest plus the host permissions for the pages to inject scripts into. Use the "host_permissions" key or the "activeTab" permission, which grants temporary host permissions. The following example uses the activeTab permission.

You can use the chrome.scripting API to inject JavaScript and CSS into websites. This is similar to what you can do with content scripts. But by using the chrome.scripting namespace, extensions can make decisions at runtime.

You can use the target parameter to specify a target to inject JavaScript or CSS into.

The only required field is tabId. By default, an injection will run in the main frame of the specified tab.

To run in all frames of the specified tab, you can set the allFrames boolean to true.

You can also inject into specific frames of a tab by specifying individual frame IDs. For more information on frame IDs, see the chrome.webNavigation API.

Extensions can specify the code to be injected either via an external file or a runtime variable.

Files are specified as strings that are paths relative to the extension's root directory. The following code will inject the file script.js into the main frame of the tab.

When injecting JavaScript with scripting.executeScript(), you can specify a function to be executed instead of a file. This function should be a function variable available to the current extension context.

You can work around this by using the args property:

If injecting CSS within a page, you can also specify a string to be used in the css property. This option is only available for scripting.insertCSS(); you can't execute a string using scripting.executeScript().

The results of executing JavaScript are passed to the extension. A single result is included per-frame. The main frame is guaranteed to be the first index in the resulting array; all other frames are in a non-deterministic order.

scripting.insertCSS() does not return any results.

If the resulting value of the script execution is a promise, Chrome will wait for the promise to settle and return the resulting value.

The following snippet contains a function that unregisters all dynamic content scripts the extension has previously registered.

To try the chrome.scripting

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Scripting Extension",
  "manifest_version": 3,
  "permissions": ["scripting", "activeTab"],
  ...
}
```

Example 2 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId()},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected"));
```

Example 3 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), allFrames : true},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected in all frames"));
```

Example 4 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), frameIds : [ frameId1, frameId2 ]},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected on target frames"));
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#readingList

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## chrome.runtime Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/runtime#method-connect

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

## chrome.runtime Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onUpdateAvailable

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

## chrome.storage Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/storage#property-managed

**Contents:**
- chrome.storage Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Concepts and usage
  - Can extensions use web storage APIs?
  - Storage areas
  - Storage and throttling limits
- Use cases
  - Respond to storage updates
  - Asynchronous preload from storage

Description Use the chrome.storage API to store, retrieve, and track changes to user data.

Use the chrome.storage API to store, retrieve, and track changes to user data.

To use the storage API, declare the "storage" permission in the extension manifest. For example:

The Storage API provides an extension-specific way to persist user data and state. It's similar to the web platform's storage APIs (IndexedDB, and Storage), but was designed to meet the storage needs of extensions. The following are a few key features:

While extensions can use the Storage interface (accessible from window.localStorage) in some contexts (popup and other HTML pages), we don't recommend it for the following reasons:

To move data from web storage APIs to extension storage APIs from a service worker:

There are also some nuances to how web storage APIs work in extensions. Learn more in the Storage and Cookies article.

The Storage API is divided into the following storage areas:

The Storage API has the following usage limitations:

For details on storage area limitations and what happens when they're exceeded, see the quota information for sync, local, and session.

The following sections demonstrate common use cases for the Storage API.

To track changes made to storage, add a listener to its onChanged event. When anything changes in storage, that event fires. The sample code listens for these changes:

We can take this idea even further. In this example, we have an options page that allows the user to toggle a "debug mode" (implementation not shown here). The options page immediately saves the new settings to storage.sync, and the service worker uses storage.onChanged to apply the setting as soon as possible.

Because service workers don't run all the time, Manifest V3 extensions sometimes need to asynchronously load data from storage before they execute their event handlers. To do this, the following snippet uses an async action.onClicked event handler that waits for the storageCache global to be populated before executing its logic.

You can view and edit data stored using the API in DevTools. To learn more, see the View and edit extension storage page in the DevTools documentation.

The following samples demonstrate the local, sync, and session storage areas:

To see other demos of the Storage API, explore any of the following samples:

Types AccessLevel Chrome 102+ The storage area's access level. Enum "TRUSTED_CONTEXTS" Specifies contexts originating from the extension 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "storage"
  ],
  ...
}
```

Example 2 (javascript):
```javascript
chrome.storage.onChanged.addListener((changes, namespace) => {
  for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
    console.log(
      `Storage key "${key}" in namespace "${namespace}" changed.`,
      `Old value was "${oldValue}", new value is "${newValue}".`
    );
  }
});
```

Example 3 (unknown):
```unknown
<!-- type="module" allows you to use top level await -->
<script defer src="options.js" type="module"></script>
<form id="optionsForm">
  <label for="debug">
    <input type="checkbox" name="debug" id="debug">
    Enable debug mode
  </label>
</form>
```

Example 4 (javascript):
```javascript
// In-page cache of the user's options
const options = {};
const optionsForm = document.getElementById("optionsForm");

// Immediately persist options changes
optionsForm.debug.addEventListener("change", (event) => {
  options.debug = event.target.checked;
  chrome.storage.sync.set({ options });
});

// Initialize the form with the user's option settings
const data = await chrome.storage.sync.get("options");
Object.assign(options, data.options);
optionsForm.debug.checked = Boolean(options.debug);
```

---

## chrome.declarativeNetRequest Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#implementation-matching-algorithm

**Contents:**
- chrome.declarativeNetRequest Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Rules and rulesets
  - Dynamic and session-scoped rulesets
  - Static rulesets
- Expedited review
- Enable and disable static rules and rulesets

Description The chrome.declarativeNetRequest API is used to block or modify network requests by specifying declarative rules. This lets extensions modify network requests without intercepting them and viewing their content, thus providing more privacy.

The chrome.declarativeNetRequest API is used to block or modify network requests by specifying declarative rules. This lets extensions modify network requests without intercepting them and viewing their content, thus providing more privacy.

Permissions declarativeNetRequestdeclarativeNetRequestWithHostAccess

The "declarativeNetRequest" and "declarativeNetRequestWithHostAccess" permissions provide the same capabilities. The differences between them is when permissions are requested or granted.

Availability Chrome 84+

In addition to the permissions described previously, certain types of rulesets, static rulesets specifically, require declaring the "declarative_net_request" manifest key, which should be a dictionary with a single key called "rule_resources". This key is an array containing dictionaries of type Ruleset, as shown in the following. (Note that the name 'Ruleset' does not appear in the manifest's JSON since it is merely an array.) Static rulesets are explained later in this document.

To use this API, specify one or more rulesets. A ruleset contains an array of rules. A single rule does one of the following:

There are three types of rulesets, managed in slightly different ways.

Dynamic and session rulesets are managed using JavaScript while an extension is in use.

There is only one each of these ruleset types. An extension can add or remove rules to them dynamically by calling updateDynamicRules() and updateSessionRules(), provided the rule limits aren't exceeded. For information on rule limits, see Rule limits. You can see an example of this under code examples.

Unlike dynamic and session rules, static rules are packaged, installed, and updated when an extension is installed or upgraded. They're stored in rule files in JSON format, which are indicated to the extension using the "declarative_net_request" and "rule_resources" keys as described above, as well as one or more Ruleset dictionaries. A Ruleset dictionary contains a path to the rule file, an ID for the ruleset contained in the file, and whether the ruleset is enabled or disabled. The last two are important when you enable or disable a ruleset programmatically.

To test rule files, load your extension unpacked. Errors and warnings a

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...

  "declarative_net_request" : {
    "rule_resources" : [{
      "id": "ruleset_1",
      "enabled": true,
      "path": "rules_1.json"
    }, {
      "id": "ruleset_2",
      "enabled": false,
      "path": "rules_2.json"
    }]
  },
  "permissions": [
    "declarativeNetRequest",
    "declarativeNetRequestFeedback"
  ],
  "host_permissions": [
    "http://www.blogger.com/*",
    "http://*.google.com/*"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
{
  ...
  "declarative_net_request" : {
    "rule_resources" : [{
      "id": "ruleset_1",
      "enabled": true,
      "path": "rules_1.json"
    },
    ...
    ]
  }
  ...
}
```

Example 3 (unknown):
```unknown
{
  "id" : 1,
  "priority": 1,
  "action" : { "type" : "block" },
  "condition" : {
    "urlFilter" : "abc",
    "initiatorDomains" : ["foo.com"],
    "resourceTypes" : ["script"]
  }
}
```

Example 4 (unknown):
```unknown
rules_1.json: Rule with id 1 specified a more complex regex than allowed
as part of the "regexFilter" key.
```

---

## chrome.runtime Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onMessage

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

## chrome.scripting Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/scripting#method-unregisterContentScripts

**Contents:**
- chrome.scripting Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Concepts and usage
  - Injection targets
  - Injected code
    - Files
    - Runtime functions

Description Use the chrome.scripting API to execute script in different contexts.

Use the chrome.scripting API to execute script in different contexts.

Permissions scripting

Availability Chrome 88+ MV3+

To use the chrome.scripting API, declare the "scripting" permission in the manifest plus the host permissions for the pages to inject scripts into. Use the "host_permissions" key or the "activeTab" permission, which grants temporary host permissions. The following example uses the activeTab permission.

You can use the chrome.scripting API to inject JavaScript and CSS into websites. This is similar to what you can do with content scripts. But by using the chrome.scripting namespace, extensions can make decisions at runtime.

You can use the target parameter to specify a target to inject JavaScript or CSS into.

The only required field is tabId. By default, an injection will run in the main frame of the specified tab.

To run in all frames of the specified tab, you can set the allFrames boolean to true.

You can also inject into specific frames of a tab by specifying individual frame IDs. For more information on frame IDs, see the chrome.webNavigation API.

Extensions can specify the code to be injected either via an external file or a runtime variable.

Files are specified as strings that are paths relative to the extension's root directory. The following code will inject the file script.js into the main frame of the tab.

When injecting JavaScript with scripting.executeScript(), you can specify a function to be executed instead of a file. This function should be a function variable available to the current extension context.

You can work around this by using the args property:

If injecting CSS within a page, you can also specify a string to be used in the css property. This option is only available for scripting.insertCSS(); you can't execute a string using scripting.executeScript().

The results of executing JavaScript are passed to the extension. A single result is included per-frame. The main frame is guaranteed to be the first index in the resulting array; all other frames are in a non-deterministic order.

scripting.insertCSS() does not return any results.

If the resulting value of the script execution is a promise, Chrome will wait for the promise to settle and return the resulting value.

The following snippet contains a function that unregisters all dynamic content scripts the extension has previously registered.

To try the chrome.scripting

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Scripting Extension",
  "manifest_version": 3,
  "permissions": ["scripting", "activeTab"],
  ...
}
```

Example 2 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId()},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected"));
```

Example 3 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), allFrames : true},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected in all frames"));
```

Example 4 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), frameIds : [ frameId1, frameId2 ]},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected on target frames"));
```

---

## chrome.devtools.recorder Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/devtools/recorder

**Contents:**
- chrome.devtools.recorder Stay organized with collections Save and categorize content based on your preferences.
- Description
- Availability
- Concepts and usage
  - Customizing the export feature
  - Customizing the replay button
- Examples
  - Export plugin
  - Replay plugin
- Types

Description Use the chrome.devtools.recorder API to customize the Recorder panel in DevTools.

Use the chrome.devtools.recorder API to customize the Recorder panel in DevTools.

devtools.recorder API is a preview feature that allows you to extend the Recorder panel in Chrome DevTools.

See DevTools APIs summary for general introduction to using Developer Tools APIs.

Availability Chrome 105+

To register an extension plugin, use the registerRecorderExtensionPlugin function. This function requires a plugin instance, a name and a mediaType as parameters. The plugin instance must implement two methods: stringify and stringifyStep.

The name provided by the extension shows up in the Export menu in the Recorder panel.

Depending on the export context, when the user clicks the export option provided by the extension, the Recorder panel invokes one of the two functions:

The mediaType parameter allows the extension to specify the kind of output it generates with the stringify and stringifyStep functions. For example, application/javascript if the result is a JavaScript program.

To customize the replay button in the Recorder, use the registerRecorderExtensionPlugin function. The plugin must implement the replay method for the customization to take effect. If the method is detected, a replay button will appear in the Recorder. Upon clicking the button, the current recording object will be passed as the first argument to the replay method.

At this point, the extension can display a RecorderView for handling the replay or use other extension APIs to process the replay request. To create a new RecorderView, invoke chrome.devtools.recorder.createView.

The following code implements an extension plugin that stringifes a recording using JSON.stringify:

The following code implements an extension plugin that creates a dummy Recorder view and displays it upon a replay request:

Find a complete extension example on GitHub.

Types RecorderExtensionPlugin A plugin interface that the Recorder panel invokes to customize the Recorder panel. Properties replay void Chrome 112+ Allows the extension to implement custom replay functionality. The replay function looks like: (recording: object) => {...} recording object A recording of the user interaction with the page. This should match Puppeteer's recording schema. stringify void Converts a recording from the Recorder panel format into a string. The stringify function looks like: (recording: object) => {...} recording object A reco

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
class MyPlugin {
  stringify(recording) {
    return Promise.resolve(JSON.stringify(recording));
  }
  stringifyStep(step) {
    return Promise.resolve(JSON.stringify(step));
  }
}

chrome.devtools.recorder.registerRecorderExtensionPlugin(
  new MyPlugin(),
  /*name=*/'MyPlugin',
  /*mediaType=*/'application/json'
);
```

Example 2 (javascript):
```javascript
const view = await chrome.devtools.recorder.createView(
  /* name= */ 'ExtensionName',
  /* pagePath= */ 'Replay.html'
);

let latestRecording;

view.onShown.addListener(() => {
  // Recorder has shown the view. Send additional data to the view if needed.
  chrome.runtime.sendMessage(JSON.stringify(latestRecording));
});

view.onHidden.addListener(() => {
  // Recorder has hidden the view.
});

export class RecorderPlugin {
  replay(recording) {
    // Share the data with the view.
    latestRecording = recording;
    // Request to show the view.
    view.show();
  }
}

chrome.devtools.recorde
...
```

---

## chrome.storage Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/storage#method-StorageArea-getKeys

**Contents:**
- chrome.storage Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Concepts and usage
  - Can extensions use web storage APIs?
  - Storage areas
  - Storage and throttling limits
- Use cases
  - Respond to storage updates
  - Asynchronous preload from storage

Description Use the chrome.storage API to store, retrieve, and track changes to user data.

Use the chrome.storage API to store, retrieve, and track changes to user data.

To use the storage API, declare the "storage" permission in the extension manifest. For example:

The Storage API provides an extension-specific way to persist user data and state. It's similar to the web platform's storage APIs (IndexedDB, and Storage), but was designed to meet the storage needs of extensions. The following are a few key features:

While extensions can use the Storage interface (accessible from window.localStorage) in some contexts (popup and other HTML pages), we don't recommend it for the following reasons:

To move data from web storage APIs to extension storage APIs from a service worker:

There are also some nuances to how web storage APIs work in extensions. Learn more in the Storage and Cookies article.

The Storage API is divided into the following storage areas:

The Storage API has the following usage limitations:

For details on storage area limitations and what happens when they're exceeded, see the quota information for sync, local, and session.

The following sections demonstrate common use cases for the Storage API.

To track changes made to storage, add a listener to its onChanged event. When anything changes in storage, that event fires. The sample code listens for these changes:

We can take this idea even further. In this example, we have an options page that allows the user to toggle a "debug mode" (implementation not shown here). The options page immediately saves the new settings to storage.sync, and the service worker uses storage.onChanged to apply the setting as soon as possible.

Because service workers don't run all the time, Manifest V3 extensions sometimes need to asynchronously load data from storage before they execute their event handlers. To do this, the following snippet uses an async action.onClicked event handler that waits for the storageCache global to be populated before executing its logic.

You can view and edit data stored using the API in DevTools. To learn more, see the View and edit extension storage page in the DevTools documentation.

The following samples demonstrate the local, sync, and session storage areas:

To see other demos of the Storage API, explore any of the following samples:

Types AccessLevel Chrome 102+ The storage area's access level. Enum "TRUSTED_CONTEXTS" Specifies contexts originating from the extension 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "storage"
  ],
  ...
}
```

Example 2 (javascript):
```javascript
chrome.storage.onChanged.addListener((changes, namespace) => {
  for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
    console.log(
      `Storage key "${key}" in namespace "${namespace}" changed.`,
      `Old value was "${oldValue}", new value is "${newValue}".`
    );
  }
});
```

Example 3 (unknown):
```unknown
<!-- type="module" allows you to use top level await -->
<script defer src="options.js" type="module"></script>
<form id="optionsForm">
  <label for="debug">
    <input type="checkbox" name="debug" id="debug">
    Enable debug mode
  </label>
</form>
```

Example 4 (javascript):
```javascript
// In-page cache of the user's options
const options = {};
const optionsForm = document.getElementById("optionsForm");

// Immediately persist options changes
optionsForm.debug.addEventListener("change", (event) => {
  options.debug = event.target.checked;
  chrome.storage.sync.set({ options });
});

// Initialize the form with the user's option settings
const data = await chrome.storage.sync.get("options");
Object.assign(options, data.options);
optionsForm.debug.checked = Boolean(options.debug);
```

---

## chrome.offscreen Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/offscreen

**Contents:**
- chrome.offscreen Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Concepts and usage
  - Reasons
- Examples
  - Maintain the lifecycle of an offscreen document
  - Before Chrome 116: check if an offscreen document is open
- Types

Description Use the offscreen API to create and manage offscreen documents.

Use the offscreen API to create and manage offscreen documents.

Permissions offscreen

To use the Offscreen API, declare the "offscreen" permission in the extension manifest. For example:

Availability Chrome 109+ MV3+

Service workers don't have DOM access, and many websites have content security policies that limit the functionality of content scripts. The Offscreen API allows the extension to use DOM APIs in a hidden document without interrupting the user experience by opening new windows or tabs. The runtime API is the only extensions API supported by offscreen documents.

Pages loaded as offscreen documents are handled differently from other types of extension pages. The extension's permissions carry over to offscreen documents, but with limits on extension API access. For example, because the chrome.runtime API is the only extensions API supported by offscreen documents, messaging must be handled using members of that API.

The following are other ways offscreen documents behave differently from normal pages:

Use chrome.offscreen.createDocument() and chrome.offscreen.closeDocument() to create and close an offscreen document. createDocument() requires the document's url, a reason, and a justification:

For a list of valid reasons, see the Reasons section. Reasons are set during document creation to determine the document's lifespan. The AUDIO_PLAYBACK reason sets the document to close after 30 seconds without audio playing. All other reasons don't set lifetime limits.

The following example shows how to ensure that an offscreen document exists. The setupOffscreenDocument() function calls runtime.getContexts() to find an existing offscreen document, or creates the document if it doesn't already exist.

Before sending a message to an offscreen document, call setupOffscreenDocument() to make sure the document exists, as demonstrated in the following example.

For complete examples, see the offscreen-clipboard and offscreen-dom demos on GitHub.

runtime.getContexts() was added in Chrome 116. In earlier versions of Chrome, use clients.matchAll() to check for an existing offscreen document:

Types CreateParameters Properties justification string A developer-provided string that explains, in more detail, the need for the background context. The user agent _may_ use this in display to the user. reasons Reason[] The reason(s) the extension is creating the offscreen document. url str

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "offscreen"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
chrome.offscreen.createDocument({
  url: 'off_screen.html',
  reasons: ['CLIPBOARD'],
  justification: 'reason for needing the document',
});
```

Example 3 (javascript):
```javascript
let creating; // A global promise to avoid concurrency issues
async function setupOffscreenDocument(path) {
  // Check all windows controlled by the service worker to see if one
  // of them is the offscreen document with the given path
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // create offscreen document
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.c
...
```

Example 4 (javascript):
```javascript
chrome.action.onClicked.addListener(async () => {
  await setupOffscreenDocument('off_screen.html');

  // Send message to offscreen document
  chrome.runtime.sendMessage({
    type: '...',
    target: 'offscreen',
    data: '...'
  });
});
```

---

## chrome.cookies Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/cookies

**Contents:**
- chrome.cookies Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Partitioning
- Examples
- Types
  - Cookie
    - Properties
  - CookieDetails
    - Properties

Description Use the chrome.cookies API to query and modify cookies, and to be notified when they change.

Use the chrome.cookies API to query and modify cookies, and to be notified when they change.

To use the cookies API, declare the "cookies" permission in your manifest along with host permissions for any hosts whose cookies you want to access. For example:

Partitioned cookies allow a site to mark that certain cookies should be keyed against the origin of the top-level frame. This means that, for example, if site A is embedded using an iframe in site B and site C, the embedded versions of a partitioned cookie from A can have different values on B and C.

By default, all API methods operate on unpartitioned cookies. The partitionKey property can be used to override this behavior.

For details on the general impact of partitioning for extensions, see Storage and Cookies.

You can find a simple example of using the cookies API in the examples/api/cookies directory. For other examples and for help in viewing the source code, see Samples.

Types Cookie Represents information about an HTTP cookie. Properties domain string The domain of the cookie (e.g. "www.google.com", "example.com"). expirationDate number optional The expiration date of the cookie as the number of seconds since the UNIX epoch. Not provided for session cookies. hostOnly boolean True if the cookie is a host-only cookie (i.e. a request's host must exactly match the domain of the cookie). httpOnly boolean True if the cookie is marked as HttpOnly (i.e. the cookie is inaccessible to client-side scripts). name string The name of the cookie. partitionKey CookiePartitionKey optional Chrome 119+ The partition key for reading or modifying cookies with the Partitioned attribute. path string The path of the cookie. sameSite SameSiteStatus Chrome 51+ The cookie's same-site status (i.e. whether the cookie is sent with cross-site requests). secure boolean True if the cookie is marked as Secure (i.e. its scope is limited to secure channels, typically HTTPS). session boolean True if the cookie is a session cookie, as opposed to a persistent cookie with an expiration date. storeId string The ID of the cookie store containing this cookie, as provided in getAllCookieStores(). value string The value of the cookie. CookieDetails Chrome 88+ Details to identify the cookie. Properties name string The name of the cookie to access. partitionKey CookiePartitionKey optional Chrome 119+ The partition key for reading or 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "host_permissions": [
    "*://*.google.com/"
  ],
  "permissions": [
    "cookies"
  ],
  ...
}
```

---

## chrome.events Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/events#filtered

**Contents:**
- chrome.events Stay organized with collections Save and categorize content based on your preferences.
- Description
- Concepts and usage
  - Declarative Event Handlers
    - Rules
    - Event objects
    - Add rules
    - Remove rules
    - Retrieve rules
    - Performance

Description The chrome.events namespace contains common types used by APIs dispatching events to notify you when something interesting happens.

The chrome.events namespace contains common types used by APIs dispatching events to notify you when something interesting happens.

An Event is an object that lets you be notified when something interesting happens. Here's an example of using the chrome.alarms.onAlarm event to be notified whenever an alarm has elapsed:

As the example shows, you register for notification using addListener(). The argument to addListener() is always a function that you define to handle the event, but the parameters to the function depend on which event you're handling. Checking the documentation for alarms.onAlarm, you can see that the function has a single parameter: an alarms.Alarm object that has details about the elapsed alarm.

Example APIs using Events: alarms, i18n, identity, runtime. Most chrome APIs do.

The declarative event handlers provide a means to define rules consisting of declarative conditions and actions. Conditions are evaluated in the browser rather than the JavaScript engine which reduces roundtrip latencies and allows for very high efficiency.

Declarative event handlers are used for example in the Declarative Content API. This page describes the underlying concepts of all declarative event handlers.

The simplest possible rule consists of one or more conditions and one or more actions:

If any of the conditions is fulfilled, all actions are executed.

In addition to conditions and actions you may give each rule an identifier, which simplifies unregistering previously registered rules, and a priority to define precedences among rules. Priorities are only considered if rules conflict each other or need to be executed in a specific order. Actions are executed in descending order of the priority of their rules.

Event objects may support rules. These event objects don't call a callback function when events happen but test whether any registered rule has at least one fulfilled condition and execute the actions associated with this rule. Event objects supporting the declarative API have three relevant methods: events.Event.addRules(), events.Event.removeRules(), and events.Event.getRules().

To add rules call the addRules() function of the event object. It takes an array of rule instances as its first parameter and a callback function that is called on completion.

If the rules were inserted successfully, the deta

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
chrome.alarms.onAlarm.addListener((alarm) => {


  appendToLog(`alarms.onAlarm -- name: ${
  alarm.name
}, scheduledTime: ${
  alarm.scheduledTime
}`);


});
```

Example 2 (javascript):
```javascript
const rule = {
  conditions: [ /* my conditions */ ],
  actions: [ /* my actions */ ]
};
```

Example 3 (javascript):
```javascript
const rule = {
  id: "my rule",  // optional, will be generated if not set.
  priority: 100,  // optional, defaults to 100.
  conditions: [ /* my conditions */ ],
  actions: [ /* my actions */ ]
};
```

Example 4 (javascript):
```javascript
const rule_list = [rule1, rule2, ...];

addRules(rule_list, (details) => {

  ...
});
```

---

## API reference Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv2/reference

**Contents:**
- API reference Stay organized with collections Save and categorize content based on your preferences.

Most extensions need access to one or more Chrome Extensions APIs to function. This API reference describes the APIs available for use in extensions and presents example use cases.

Use the chrome.accessibilityFeatures API to manage Chrome's accessibility features. This API relies on the ChromeSetting prototype of the type API for getting and setting individual accessibility features. In order to get feature states the extension must request accessibilityFeatures.read permission. For modifying feature state, the extension needs accessibilityFeatures.modify permission. Note that accessibilityFeatures.modify does not imply accessibilityFeatures.read permission.

Use the chrome.alarms API to schedule code to run periodically or at a specified time in the future.

The chrome.audio API is provided to allow users to get information about and control the audio devices attached to the system. This API is currently only available in kiosk mode for ChromeOS.

Use the chrome.bookmarks API to create, organize, and otherwise manipulate bookmarks. Also see Override Pages, which you can use to create a custom Bookmark Manager page.

Use browser actions to put icons in the main Google Chrome toolbar, to the right of the address bar. In addition to its icon, a browser action can have a tooltip, a badge, and a popup.

Use the chrome.browsingData API to remove browsing data from a user's local profile.

Use this API to expose certificates to the platform which can use these certificates for TLS authentications.

Use the commands API to add keyboard shortcuts that trigger actions in your extension, for example, an action to open the browser action or send a command to the extension.

Use the chrome.contentSettings API to change settings that control whether websites can use features such as cookies, JavaScript, and plugins. More generally speaking, content settings allow you to customize Chrome's behavior on a per-site basis instead of globally.

Use the chrome.contextMenus API to add items to Google Chrome's context menu. You can choose what types of objects your context menu additions apply to, such as images, hyperlinks, and pages.

Use the chrome.cookies API to query and modify cookies, and to be notified when they change.

The chrome.debugger API serves as an alternate transport for Chrome's remote debugging protocol. Use chrome.debugger to attach to one or more tabs to instrument network interaction, debug JavaScript, mutate the DOM and CSS, and more. Use the Debuggee p

*[Content truncated]*

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#geolocation

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## chrome.sidePanel Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/sidePanel

**Contents:**
- chrome.sidePanel Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Concepts and usage
  - Use cases
    - Display the same side panel on every site
    - Enable a side panel on a specific site
    - Open the side panel by clicking the toolbar icon
    - Programmatically open the side panel on user interaction

Description Use the chrome.sidePanel API to host content in the browser's side panel alongside the main content of a webpage.

Use the chrome.sidePanel API to host content in the browser's side panel alongside the main content of a webpage.

Permissions sidePanel

To use the Side Panel API, add the "sidePanel" permission in the extension manifest file:

Availability Chrome 114+ MV3+

The Side Panel API allows extensions to display their own UI in the side panel, enabling persistent experiences that complement the user's browsing journey.

Some features include:

The following sections demonstrate some common use cases for the Side Panel API. See Extension samples for complete extension examples.

The side panel can be set initially from the "default_path" property in the "side_panel" key of the manifest to display the same side panel on every site. This should point to a relative path within the extension directory.

An extension can use sidepanel.setOptions() to enable a side panel on a specific tab. This example uses chrome.tabs.onUpdated() to listen for any updates made to the tab. It checks if the URL is www.google.com and enables the side panel. Otherwise, it disables it.

When a user temporarily switches to a tab where the side panel is not enabled, the side panel will be hidden. It will automatically show again when the user switches to a tab where it was previously open.

When the user navigates to a site where the side panel is not enabled, the side panel will close, and the extension won't show in the side panel drop-down menu.

For a complete example, see the Tab-specific side panel sample.

Developers can allow users to open the side panel when they click the action toolbar icon with sidePanel.setPanelBehavior(). First, declare the "action" key in the manifest:

Now, add this code to the previous example:

Chrome 116 introduces sidePanel.open(). It allows extensions to open the side panel through an extension user gesture, such as clicking on the action icon. Or a user interaction on an extension page or content script, such as clicking a button. For a complete demo, see the Open Side Panel sample extension.

The following code shows how to open a global side panel on the current window when the user clicks on a context menu. When using sidePanel.open(), you must choose the context in which it should open. Use windowId to open a global side panel. Alternatively, set the tabId to open the side panel only on a specific tab.

Extensions can use si

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My side panel extension",
  ...
  "permissions": [
    "sidePanel"
  ]
}
```

Example 2 (unknown):
```unknown
{
  "name": "My side panel extension",
  ...
  "side_panel": {
    "default_path": "sidepanel.html"
  }
  ...
}
```

Example 3 (unknown):
```unknown
<!DOCTYPE html>
<html>
  <head>
    <title>My Sidepanel</title>
  </head>
  <body>
    <h1>All sites sidepanel extension</h1>
    <p>This side panel is enabled on all sites</p>
  </body>
</html>
```

Example 4 (javascript):
```javascript
const GOOGLE_ORIGIN = 'https://www.google.com';

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url) return;
  const url = new URL(tab.url);
  // Enables the side panel on google.com
  if (url.origin === GOOGLE_ORIGIN) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true
    });
  } else {
    // Disables the side panel on all other sites
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false
    });
  }
});
```

---

## chrome.commands Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/commands#usage

**Contents:**
- chrome.commands Stay organized with collections Save and categorize content based on your preferences.
- Description
- Manifest
- Concepts and usage
  - Supported Keys
  - Key combination requirements
  - Handle command events
  - Action commands
  - Scope
- Examples

Description Use the commands API to add keyboard shortcuts that trigger actions in your extension, for example, an action to open the browser action or send a command to the extension.

Use the commands API to add keyboard shortcuts that trigger actions in your extension, for example, an action to open the browser action or send a command to the extension.

Manifest The following keys must be declared in the manifest to use this API."commands"

The following keys must be declared in the manifest to use this API.

The Commands API allows extension developers to define specific commands, and bind them to a default key combination. Each command an extension accepts must be declared as properties of the "commands" object in the extension's manifest.

The property key is used as the command's name. Command objects can take two properties.

An optional property that declares default keyboard shortcuts for the command. If omitted, the command will be unbound. This property can either take a string or an object value.

A string value specifies the default keyboard shortcut that should be used across all platforms.

See Key combination requirements for additional details.

An extension can have many commands, but may specify at most four suggested keyboard shortcuts. The user can manually add more shortcuts from the chrome://extensions/shortcuts dialog.

The following keys are usable command shortcuts. Key definitions are case sensitive. Attempting to load an extension with an incorrectly cased key will result in a manifest parse error at installation time.

General–Comma, Period, Home, End, PageUp, PageDown, Space, Insert, Delete

Arrow keys–Up, Down, Left, Right

Media Keys–MediaNextTrack, MediaPlayPause, MediaPrevTrack, MediaStop

Ctrl, Alt, Shift, MacCtrl (macOS only), Option (macOS only), Command (macOS only), Search (ChromeOS only)

Extension command shortcuts must include either Ctrl or Alt.

Modifiers cannot be used in combination with Media Keys.

On many macOS keyboards, Alt refers to the Option key.

On macOS, Command or MacCtrl can also be used in place of Ctrl, and the Option key can be used in place of Alt (see next bullet point).

On macOS Ctrl is automatically converted into Command.

Command can also be used in the "mac" shortcut to explicitly refer to the Command key.

To use the Control key on macOS, replace Ctrl with MacCtrl when defining the "mac" shortcut.

Using MacCtrl in the combination for another platform will cause a validation error and

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "commands": {
    "run-foo": {
      "suggested_key": {
        "default": "Ctrl+Shift+Y",
        "mac": "Command+Shift+Y"
      },
      "description": "Run \"foo\" on the current page."
    },
    "_execute_action": {
      "suggested_key": {
        "windows": "Ctrl+Shift+Y",
        "mac": "Command+Shift+Y",
        "chromeos": "Ctrl+Shift+U",
        "linux": "Ctrl+Shift+J"
      }
    }
  },
  ...
}
```

Example 2 (javascript):
```javascript
chrome.commands.onCommand.addListener((command) => {


  console.log(`Command: ${
  command
}`);


});
```

Example 3 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "commands": {
    "toggle-feature-foo": {
      "suggested_key": {
        "default": "Ctrl+Shift+5"
      },
      "description": "Toggle feature foo",
      "global": true
    }
  },
  ...
}
```

Example 4 (unknown):
```unknown
{
  "name": "Command demo - basic",
  "version": "1.0",
  "manifest_version": 3,
  "background": {
    "service_worker": "service-worker.js"
  },
  "commands": {
    "inject-script": {
      "suggested_key": "Ctrl+Shift+Y",
      "description": "Inject a script on the page"
    }
  }
}
```

---

## chrome.commands Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/commands

**Contents:**
- chrome.commands Stay organized with collections Save and categorize content based on your preferences.
- Description
- Manifest
- Concepts and usage
  - Supported Keys
  - Key combination requirements
  - Handle command events
  - Action commands
  - Scope
- Examples

Description Use the commands API to add keyboard shortcuts that trigger actions in your extension, for example, an action to open the browser action or send a command to the extension.

Use the commands API to add keyboard shortcuts that trigger actions in your extension, for example, an action to open the browser action or send a command to the extension.

Manifest The following keys must be declared in the manifest to use this API."commands"

The following keys must be declared in the manifest to use this API.

The Commands API allows extension developers to define specific commands, and bind them to a default key combination. Each command an extension accepts must be declared as properties of the "commands" object in the extension's manifest.

The property key is used as the command's name. Command objects can take two properties.

An optional property that declares default keyboard shortcuts for the command. If omitted, the command will be unbound. This property can either take a string or an object value.

A string value specifies the default keyboard shortcut that should be used across all platforms.

See Key combination requirements for additional details.

An extension can have many commands, but may specify at most four suggested keyboard shortcuts. The user can manually add more shortcuts from the chrome://extensions/shortcuts dialog.

The following keys are usable command shortcuts. Key definitions are case sensitive. Attempting to load an extension with an incorrectly cased key will result in a manifest parse error at installation time.

General–Comma, Period, Home, End, PageUp, PageDown, Space, Insert, Delete

Arrow keys–Up, Down, Left, Right

Media Keys–MediaNextTrack, MediaPlayPause, MediaPrevTrack, MediaStop

Ctrl, Alt, Shift, MacCtrl (macOS only), Option (macOS only), Command (macOS only), Search (ChromeOS only)

Extension command shortcuts must include either Ctrl or Alt.

Modifiers cannot be used in combination with Media Keys.

On many macOS keyboards, Alt refers to the Option key.

On macOS, Command or MacCtrl can also be used in place of Ctrl, and the Option key can be used in place of Alt (see next bullet point).

On macOS Ctrl is automatically converted into Command.

Command can also be used in the "mac" shortcut to explicitly refer to the Command key.

To use the Control key on macOS, replace Ctrl with MacCtrl when defining the "mac" shortcut.

Using MacCtrl in the combination for another platform will cause a validation error and

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "commands": {
    "run-foo": {
      "suggested_key": {
        "default": "Ctrl+Shift+Y",
        "mac": "Command+Shift+Y"
      },
      "description": "Run \"foo\" on the current page."
    },
    "_execute_action": {
      "suggested_key": {
        "windows": "Ctrl+Shift+Y",
        "mac": "Command+Shift+Y",
        "chromeos": "Ctrl+Shift+U",
        "linux": "Ctrl+Shift+J"
      }
    }
  },
  ...
}
```

Example 2 (javascript):
```javascript
chrome.commands.onCommand.addListener((command) => {


  console.log(`Command: ${
  command
}`);


});
```

Example 3 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "commands": {
    "toggle-feature-foo": {
      "suggested_key": {
        "default": "Ctrl+Shift+5"
      },
      "description": "Toggle feature foo",
      "global": true
    }
  },
  ...
}
```

Example 4 (unknown):
```unknown
{
  "name": "Command demo - basic",
  "version": "1.0",
  "manifest_version": 3,
  "background": {
    "service_worker": "service-worker.js"
  },
  "commands": {
    "inject-script": {
      "suggested_key": "Ctrl+Shift+Y",
      "description": "Inject a script on the page"
    }
  }
}
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#cookies

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## Unit testing Chrome Extensions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/how-to/test/unit-testing

**Contents:**
- Unit testing Chrome Extensions Stay organized with collections Save and categorize content based on your preferences.
- Example: Using mocks with Jest
- Next steps

Unit testing allows small sections of code to be tested in isolation from the rest of your extension, and outside of the browser. For example, you could write a unit test to ensure that a helper method correctly writes a value to storage.

Code written without using extension APIs can be tested as normal, using a framework such as Jest. To make code easier to test this way, consider using techniques such as dependency injection which can help to remove dependencies on the chrome namespace in your lower level implementation.

If you need to test code which includes extension APIs, consider using mocks.

Create a jest.config.js file, which declares a setup file that will run before all tests:

In mock-extension-apis.js, add implementations for the specific functions you expect to call:

mock-extension-apis.js:

Then, use jest.spy to mock a return value in a test:

To ensure your extension functions as expected, we recommend adding end-to-end tests. See Testing Chrome Extensions with Puppeteer for a complete tutorial.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-10-12 UTC.

**Examples:**

Example 1 (unknown):
```unknown
module.exports = {
  setupFiles: ['<rootDir>/mock-extension-apis.js']
};
```

Example 2 (javascript):
```javascript
global.chrome = {
  tabs: {
    query: async () => { throw new Error("Unimplemented.") };
  }
};
```

Example 3 (javascript):
```javascript
test("getActiveTabId returns active tab ID", async () => {
  jest.spyOn(chrome.tabs, "query").mockResolvedValue([{
    id: 3,
    active: true,
    currentWindow: true
  }]);
  expect(await getActiveTabId()).toBe(3);
});
```

---

## chrome.tabs Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab

**Contents:**
- chrome.tabs Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Use cases
  - Open an extension page in a new tab
  - Get the current tab
  - Mute the specified tab
  - Move the current tab to the first position when clicked
  - Pass a message to a selected tab's content script
- Extension examples

Description Use the chrome.tabs API to interact with the browser's tab system. You can use this API to create, modify, and rearrange tabs in the browser.

Use the chrome.tabs API to interact with the browser's tab system. You can use this API to create, modify, and rearrange tabs in the browser.

The Tabs API not only offers features for manipulating and managing tabs, but can also detect the language of the tab, take a screenshot, and communicate with a tab's content scripts.

Most features don't require any permissions to use. For example: creating a new tab, reloading a tab, navigating to another URL, etc.

There are three permissions developers should be aware of when working with the Tabs API.

This permission does not give access to the chrome.tabs namespace. Instead, it grants an extension the ability to call tabs.query() against four sensitive properties on tabs.Tab instances: url, pendingUrl, title, and favIconUrl.

Host permissions allow an extension to read and query a matching tab's four sensitive tabs.Tab properties. They can also interact directly with the matching tabs using methods such as tabs.captureVisibleTab(), scripting.executeScript(), scripting.insertCSS(), and scripting.removeCSS().

activeTab grants an extension temporary host permission for the current tab in response to a user invocation. Unlike host permissions, activeTab does not trigger any warnings.

The following sections demonstrate some common use cases.

A common pattern for extensions is to open an onboarding page in a new tab when the extension is installed. The following example shows how to do this.

This example demonstrates how an extension's service worker can retrieve the active tab from the currently-focused window (or most recently-focused window, if no Chrome windows are focused). This can usually be thought of as the user's current tab.

This example shows how an extension can toggle the muted state for a given tab.

This example shows how to move a tab while a drag may or may not be in progress. While this example uses chrome.tabs.move, you can use the same waiting pattern for other calls that modify tabs while a drag is in progress.

This example demonstrates how an extension's service worker can communicate with content scripts in specific browser tabs using tabs.sendMessage().

For more Tabs API extensions demos, explore any of the following:

Types MutedInfo Chrome 46+ The tab's muted state and the reason for the last state change. Properties extensionId 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "tabs"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "host_permissions": [
    "http://*/*",
    "https://*/*"
  ],
  ...
}
```

Example 3 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "activeTab"
  ],
  ...
}
```

Example 4 (javascript):
```javascript
chrome.runtime.onInstalled.addListener(({reason}) => {
  if (reason === 'install') {
    chrome.tabs.create({
      url: "onboarding.html"
    });
  }
});
```

---

## chrome.tabs Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onRemoved

**Contents:**
- chrome.tabs Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Use cases
  - Open an extension page in a new tab
  - Get the current tab
  - Mute the specified tab
  - Move the current tab to the first position when clicked
  - Pass a message to a selected tab's content script
- Extension examples

Description Use the chrome.tabs API to interact with the browser's tab system. You can use this API to create, modify, and rearrange tabs in the browser.

Use the chrome.tabs API to interact with the browser's tab system. You can use this API to create, modify, and rearrange tabs in the browser.

The Tabs API not only offers features for manipulating and managing tabs, but can also detect the language of the tab, take a screenshot, and communicate with a tab's content scripts.

Most features don't require any permissions to use. For example: creating a new tab, reloading a tab, navigating to another URL, etc.

There are three permissions developers should be aware of when working with the Tabs API.

This permission does not give access to the chrome.tabs namespace. Instead, it grants an extension the ability to call tabs.query() against four sensitive properties on tabs.Tab instances: url, pendingUrl, title, and favIconUrl.

Host permissions allow an extension to read and query a matching tab's four sensitive tabs.Tab properties. They can also interact directly with the matching tabs using methods such as tabs.captureVisibleTab(), scripting.executeScript(), scripting.insertCSS(), and scripting.removeCSS().

activeTab grants an extension temporary host permission for the current tab in response to a user invocation. Unlike host permissions, activeTab does not trigger any warnings.

The following sections demonstrate some common use cases.

A common pattern for extensions is to open an onboarding page in a new tab when the extension is installed. The following example shows how to do this.

This example demonstrates how an extension's service worker can retrieve the active tab from the currently-focused window (or most recently-focused window, if no Chrome windows are focused). This can usually be thought of as the user's current tab.

This example shows how an extension can toggle the muted state for a given tab.

This example shows how to move a tab while a drag may or may not be in progress. While this example uses chrome.tabs.move, you can use the same waiting pattern for other calls that modify tabs while a drag is in progress.

This example demonstrates how an extension's service worker can communicate with content scripts in specific browser tabs using tabs.sendMessage().

For more Tabs API extensions demos, explore any of the following:

Types MutedInfo Chrome 46+ The tab's muted state and the reason for the last state change. Properties extensionId 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "tabs"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "host_permissions": [
    "http://*/*",
    "https://*/*"
  ],
  ...
}
```

Example 3 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "activeTab"
  ],
  ...
}
```

Example 4 (javascript):
```javascript
chrome.runtime.onInstalled.addListener(({reason}) => {
  if (reason === 'install') {
    chrome.tabs.create({
      url: "onboarding.html"
    });
  }
});
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#webAuthenticationProxy

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## The Prompt API Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/ai/prompt-api

**Contents:**
- The Prompt API Stay organized with collections Save and categorize content based on your preferences.
  - Review the hardware requirements
- Use the Prompt API
  - Model parameters
  - Create a session
  - Add context with initial prompts
    - Constrain responses with a prefix
  - Add expected input and output
    - Multimodal capabilities
  - Append messages

Thomas Steiner GitHub LinkedIn Mastodon Bluesky Homepage Alexandra Klepper GitHub Bluesky

Published: May 20, 2025, Last updated: September 21, 2025

Published: May 20, 2025, Last updated: September 21, 2025

With the Prompt API, you can send natural language requests to Gemini Nano in the browser.

There are many ways you can use the Prompt API. For example, you could build:

These are just a few possibilities, and we're excited to see what you create.

The following requirements exist for developers and the users who operate features using these APIs in Chrome. Other browsers may have different operating requirements.

The Language Detector and Translator APIs work in Chrome on desktop. These APIs do not work on mobile devices. The Prompt API, Summarizer API, Writer API, Rewriter API, and Proofreader API work in Chrome when the following conditions are met:

Gemini Nano's exact size may vary as the browser updates the model. To determine the current size, visit chrome://on-device-internals.

The Prompt API uses the Gemini Nano model in Chrome. While the API is built into Chrome, the model is downloaded separately the first time an origin uses the API. Before you use this API, acknowledge Google's Generative AI Prohibited Uses Policy.

To determine if the model is ready to use, call LanguageModel.availability().

To trigger the download and instantiate the language model, check for user activation. Then, call the create() function.

If the response to availability() was downloading, listen for download progress and inform the user, as the download may take time.

The params() function informs you of the language model's parameters. The object has the following fields:

Once the Prompt API can run, you create a session with the create() function.

Each session can be customized with topK and temperature using an optional options object. The default values for these parameters are returned from LanguageModel.params().

The create() function's optional options object also takes a signal field, which lets you pass an AbortSignal to destroy the session.

With initial prompts, you can provide the language model with context about previous interactions, for example, to allow the user to resume a stored session after a browser restart.

You can add an "assistant" role, in addition to previous roles, to elaborate on the model's previous responses. For example:

In some cases, instead of requesting a new response, you may want to prefill part of the "assistant"-rol

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
const availability = await LanguageModel.availability();
```

Example 2 (javascript):
```javascript
const session = await LanguageModel.create({
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloaded ${e.loaded * 100}%`);
    });
  },
});
```

Example 3 (unknown):
```unknown
await LanguageModel.params();
// {defaultTopK: 3, maxTopK: 128, defaultTemperature: 1, maxTemperature: 2}
```

Example 4 (javascript):
```javascript
const params = await LanguageModel.params();
// Initializing a new session must either specify both `topK` and
// `temperature` or neither of them.
const slightlyHighTemperatureSession = await LanguageModel.create({
  temperature: Math.max(params.defaultTemperature * 1.2, 2.0),
  topK: params.defaultTopK,
});
```

---

## chrome.runtime Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/runtime

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

## chrome.scripting Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/scripting#method-registerContentScripts

**Contents:**
- chrome.scripting Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Concepts and usage
  - Injection targets
  - Injected code
    - Files
    - Runtime functions

Description Use the chrome.scripting API to execute script in different contexts.

Use the chrome.scripting API to execute script in different contexts.

Permissions scripting

Availability Chrome 88+ MV3+

To use the chrome.scripting API, declare the "scripting" permission in the manifest plus the host permissions for the pages to inject scripts into. Use the "host_permissions" key or the "activeTab" permission, which grants temporary host permissions. The following example uses the activeTab permission.

You can use the chrome.scripting API to inject JavaScript and CSS into websites. This is similar to what you can do with content scripts. But by using the chrome.scripting namespace, extensions can make decisions at runtime.

You can use the target parameter to specify a target to inject JavaScript or CSS into.

The only required field is tabId. By default, an injection will run in the main frame of the specified tab.

To run in all frames of the specified tab, you can set the allFrames boolean to true.

You can also inject into specific frames of a tab by specifying individual frame IDs. For more information on frame IDs, see the chrome.webNavigation API.

Extensions can specify the code to be injected either via an external file or a runtime variable.

Files are specified as strings that are paths relative to the extension's root directory. The following code will inject the file script.js into the main frame of the tab.

When injecting JavaScript with scripting.executeScript(), you can specify a function to be executed instead of a file. This function should be a function variable available to the current extension context.

You can work around this by using the args property:

If injecting CSS within a page, you can also specify a string to be used in the css property. This option is only available for scripting.insertCSS(); you can't execute a string using scripting.executeScript().

The results of executing JavaScript are passed to the extension. A single result is included per-frame. The main frame is guaranteed to be the first index in the resulting array; all other frames are in a non-deterministic order.

scripting.insertCSS() does not return any results.

If the resulting value of the script execution is a promise, Chrome will wait for the promise to settle and return the resulting value.

The following snippet contains a function that unregisters all dynamic content scripts the extension has previously registered.

To try the chrome.scripting

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Scripting Extension",
  "manifest_version": 3,
  "permissions": ["scripting", "activeTab"],
  ...
}
```

Example 2 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId()},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected"));
```

Example 3 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), allFrames : true},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected in all frames"));
```

Example 4 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), frameIds : [ frameId1, frameId2 ]},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected on target frames"));
```

---

## chrome.scripting Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/scripting

**Contents:**
- chrome.scripting Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Concepts and usage
  - Injection targets
  - Injected code
    - Files
    - Runtime functions

Description Use the chrome.scripting API to execute script in different contexts.

Use the chrome.scripting API to execute script in different contexts.

Permissions scripting

Availability Chrome 88+ MV3+

To use the chrome.scripting API, declare the "scripting" permission in the manifest plus the host permissions for the pages to inject scripts into. Use the "host_permissions" key or the "activeTab" permission, which grants temporary host permissions. The following example uses the activeTab permission.

You can use the chrome.scripting API to inject JavaScript and CSS into websites. This is similar to what you can do with content scripts. But by using the chrome.scripting namespace, extensions can make decisions at runtime.

You can use the target parameter to specify a target to inject JavaScript or CSS into.

The only required field is tabId. By default, an injection will run in the main frame of the specified tab.

To run in all frames of the specified tab, you can set the allFrames boolean to true.

You can also inject into specific frames of a tab by specifying individual frame IDs. For more information on frame IDs, see the chrome.webNavigation API.

Extensions can specify the code to be injected either via an external file or a runtime variable.

Files are specified as strings that are paths relative to the extension's root directory. The following code will inject the file script.js into the main frame of the tab.

When injecting JavaScript with scripting.executeScript(), you can specify a function to be executed instead of a file. This function should be a function variable available to the current extension context.

You can work around this by using the args property:

If injecting CSS within a page, you can also specify a string to be used in the css property. This option is only available for scripting.insertCSS(); you can't execute a string using scripting.executeScript().

The results of executing JavaScript are passed to the extension. A single result is included per-frame. The main frame is guaranteed to be the first index in the resulting array; all other frames are in a non-deterministic order.

scripting.insertCSS() does not return any results.

If the resulting value of the script execution is a promise, Chrome will wait for the promise to settle and return the resulting value.

The following snippet contains a function that unregisters all dynamic content scripts the extension has previously registered.

To try the chrome.scripting

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Scripting Extension",
  "manifest_version": 3,
  "permissions": ["scripting", "activeTab"],
  ...
}
```

Example 2 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId()},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected"));
```

Example 3 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), allFrames : true},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected in all frames"));
```

Example 4 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), frameIds : [ frameId1, frameId2 ]},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected on target frames"));
```

---

## chrome.notifications Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/notifications

**Contents:**
- chrome.notifications Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Types
  - NotificationBitmap
  - NotificationButton
    - Properties
  - NotificationItem
    - Properties
  - NotificationOptions

Description Use the chrome.notifications API to create rich notifications using templates and show these notifications to users in the system tray.

Use the chrome.notifications API to create rich notifications using templates and show these notifications to users in the system tray.

Permissions notifications

Types NotificationBitmap NotificationButton Properties iconUrl string optional Deprecated since Chrome 59 Button icons not visible for Mac OS X users. title string NotificationItem Properties message string Additional details about this item. title string Title of one item of a list notification. NotificationOptions Properties appIconMaskUrl string optional Deprecated since Chrome 59 The app icon mask is not visible for Mac OS X users.A URL to the app icon mask. URLs have the same restrictions as iconUrl. The app icon mask should be in alpha channel, as only the alpha channel of the image will be considered. buttons NotificationButton[] optional Text and icons for up to two notification action buttons. contextMessage string optional Alternate notification content with a lower-weight font. eventTime number optional A timestamp associated with the notification, in milliseconds past the epoch (e.g. Date.now() + n). iconUrl string optional A URL to the sender's avatar, app icon, or a thumbnail for image notifications. URLs can be a data URL, a blob URL, or a URL relative to a resource within this extension's .crx file **Note:**This value is required for the notifications.create() method. imageUrl string optional Deprecated since Chrome 59 The image is not visible for Mac OS X users.A URL to the image thumbnail for image-type notifications. URLs have the same restrictions as iconUrl. isClickable boolean optional Deprecated since Chrome 67 This UI hint is ignored as of Chrome 67 items NotificationItem[] optional Items for multi-item notifications. Users on Mac OS X only see the first item. message string optional Main notification content. **Note:**This value is required for the notifications.create() method. priority number optional Priority ranges from -2 to 2. -2 is lowest priority. 2 is highest. Zero is default. On platforms that don't support a notification center (Windows, Linux & Mac), -2 and -1 result in an error as notifications with those priorities will not be shown at all. progress number optional Current progress ranges from 0 to 100. requireInteraction boolean optional Chrome 50+ Indicates that the notification should remain visible on scree

*[Content truncated]*

---

## chrome.runtime Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/runtime#method-sendMessage

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

## chrome.webNavigation Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/webNavigation

**Contents:**
- chrome.webNavigation Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Concepts and usage
  - Event order
  - Relation to webRequest events
  - Tab IDs
  - Timestamps
  - Frame IDs
  - Transition types and qualifiers

Description Use the chrome.webNavigation API to receive notifications about the status of navigation requests in-flight.

Use the chrome.webNavigation API to receive notifications about the status of navigation requests in-flight.

Permissions webNavigation

All chrome.webNavigation methods and events require you to declare the "webNavigation" permission in the extension manifest. For example:

For a navigation that is successfully completed, events are fired in the following order:

Any error that occurs during the process results in an onErrorOccurred event. For a specific navigation, there are no further events fired after onErrorOccurred.

If a navigating frame contains subframes, its onCommitted is fired before any of its children's onBeforeNavigate; while onCompleted is fired after all of its children's onCompleted.

If the reference fragment of a frame is changed, a onReferenceFragmentUpdated event is fired. This event can fire any time after onDOMContentLoaded, even after onCompleted.

If the history API is used to modify the state of a frame (e.g. using history.pushState(), a onHistoryStateUpdated event is fired. This event can fire any time after onDOMContentLoaded.

If a navigation restored a page from the Back Forward Cache, the onDOMContentLoaded event won't fire. The event is not fired because the content has already completed load when the page was first visited.

If a navigation was triggered using Chrome Instant or Instant Pages, a completely loaded page is swapped into the current tab. In that case, an onTabReplaced event is fired.

There is no defined ordering between events of the webRequest API and the events of the webNavigation API. It is possible that webRequest events are still received for frames that already started a new navigation, or that a navigation only proceeds after the network resources are already fully loaded.

In general, the webNavigation events are closely related to the navigation state that is displayed in the UI, while the webRequest events correspond to the state of the network stack which is generally opaque to the user.

Not all navigating tabs correspond to actual tabs in Chrome's UI, for example, a tab that is being pre-rendered. Such tabs are not accessible using the tabs API nor can you request information about them by calling webNavigation.getFrame() or webNavigation.getAllFrames(). Once such a tab is swapped in, an onTabReplaced event is fired and they become accessible through these APIs.

It's importa

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "webNavigation"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
onBeforeNavigate -> onCommitted -> [onDOMContentLoaded] -> onCompleted
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#webRequest

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## chrome.declarativeNetRequest Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest

**Contents:**
- chrome.declarativeNetRequest Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Rules and rulesets
  - Dynamic and session-scoped rulesets
  - Static rulesets
- Expedited review
- Enable and disable static rules and rulesets

Description The chrome.declarativeNetRequest API is used to block or modify network requests by specifying declarative rules. This lets extensions modify network requests without intercepting them and viewing their content, thus providing more privacy.

The chrome.declarativeNetRequest API is used to block or modify network requests by specifying declarative rules. This lets extensions modify network requests without intercepting them and viewing their content, thus providing more privacy.

Permissions declarativeNetRequestdeclarativeNetRequestWithHostAccess

The "declarativeNetRequest" and "declarativeNetRequestWithHostAccess" permissions provide the same capabilities. The differences between them is when permissions are requested or granted.

Availability Chrome 84+

In addition to the permissions described previously, certain types of rulesets, static rulesets specifically, require declaring the "declarative_net_request" manifest key, which should be a dictionary with a single key called "rule_resources". This key is an array containing dictionaries of type Ruleset, as shown in the following. (Note that the name 'Ruleset' does not appear in the manifest's JSON since it is merely an array.) Static rulesets are explained later in this document.

To use this API, specify one or more rulesets. A ruleset contains an array of rules. A single rule does one of the following:

There are three types of rulesets, managed in slightly different ways.

Dynamic and session rulesets are managed using JavaScript while an extension is in use.

There is only one each of these ruleset types. An extension can add or remove rules to them dynamically by calling updateDynamicRules() and updateSessionRules(), provided the rule limits aren't exceeded. For information on rule limits, see Rule limits. You can see an example of this under code examples.

Unlike dynamic and session rules, static rules are packaged, installed, and updated when an extension is installed or upgraded. They're stored in rule files in JSON format, which are indicated to the extension using the "declarative_net_request" and "rule_resources" keys as described above, as well as one or more Ruleset dictionaries. A Ruleset dictionary contains a path to the rule file, an ID for the ruleset contained in the file, and whether the ruleset is enabled or disabled. The last two are important when you enable or disable a ruleset programmatically.

To test rule files, load your extension unpacked. Errors and warnings a

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...

  "declarative_net_request" : {
    "rule_resources" : [{
      "id": "ruleset_1",
      "enabled": true,
      "path": "rules_1.json"
    }, {
      "id": "ruleset_2",
      "enabled": false,
      "path": "rules_2.json"
    }]
  },
  "permissions": [
    "declarativeNetRequest",
    "declarativeNetRequestFeedback"
  ],
  "host_permissions": [
    "http://www.blogger.com/*",
    "http://*.google.com/*"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
{
  ...
  "declarative_net_request" : {
    "rule_resources" : [{
      "id": "ruleset_1",
      "enabled": true,
      "path": "rules_1.json"
    },
    ...
    ]
  }
  ...
}
```

Example 3 (unknown):
```unknown
{
  "id" : 1,
  "priority": 1,
  "action" : { "type" : "block" },
  "condition" : {
    "urlFilter" : "abc",
    "initiatorDomains" : ["foo.com"],
    "resourceTypes" : ["script"]
  }
}
```

Example 4 (unknown):
```unknown
rules_1.json: Rule with id 1 specified a more complex regex than allowed
as part of the "regexFilter" key.
```

---

## Message passing Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/concepts/messaging

**Contents:**
- Message passing Stay organized with collections Save and categorize content based on your preferences.
- One-time requests
  - Responses
- Long-lived connections
- Serialization
  - Port lifetime
- Cross-extension messaging
- Send messages from web pages
- Native messaging
- Security considerations

Messaging APIs allow you to communicate between different scripts running in contexts associated with your extension. This includes communication between your service worker, chrome-extension://pages and content scripts. For example, an RSS reader extension might use content scripts to detect the presence of an RSS feed on a page, then notify the service worker to update the action icon for that page.

There are two message passing APIs: one for one-time requests, and a more complex one for long-lived connections that allow multiple messages to be sent.

For information about sending messages between extensions, see the cross-extension messages section.

To send a single message to another part of your extension, and optionally get a response, call runtime.sendMessage() or tabs.sendMessage(). These methods let you send a one-time JSON-serializable message from a content script to the extension, or from the extension to a content script. Both APIs return a Promise which resolves to the response provided by a recipient.

Sending a request from a content script looks like this:

To listen for a message, use the chrome.runtime.onMessage event:

When the event listener is called, a sendResponse function is passed as the third parameter. This is a function that can be called to provide a response. By default, the sendResponse callback must be called synchronously. If you want to do asynchronous work to get the value passed to sendResponse, you must return a literal true (not just a truthy value) from the event listener. Doing so will keep the message channel open to the other end until sendResponse is called.

If you call sendResponse without any parameters, null is sent as a response.

If multiple pages are listening for onMessage events, only the first to call sendResponse() for a particular event will succeed in sending the response. All other responses to that event will be ignored.

To create a reusable long-lived message passing channel, call:

You can name your channel by passing an options parameter with a name key to distinguish between different types of connections:

One potential use case for a long-lived connection is an automatic form-filling extension. The content script might open a channel to the extension page for a specific login, and send a message to the extension for each input element on the page to request the form data to fill in. The shared connection allows the extension to share state between extension components.

When establishing a

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
(async () => {
  const response = await chrome.runtime.sendMessage({greeting: "hello"});
  // do something with response here, not outside the function
  console.log(response);
})();
```

Example 2 (javascript):
```javascript
// Event listener
function handleMessages(message, sender, sendResponse) {
  fetch(message.url)
    .then((response) => sendResponse({statusCode: response.status}))

  // Since `fetch` is asynchronous, must return an explicit `true`
  return true;
}

chrome.runtime.onMessage.addListener(handleMessages);

// From the sender's context...
const {statusCode} = await chrome.runtime.sendMessage({
  url: 'https://example.com'
});
```

Example 3 (javascript):
```javascript
const port = chrome.runtime.connect({
  name: "example"
});
```

Example 4 (javascript):
```javascript
const port = chrome.runtime.connect({name: "knockknock"});
port.onMessage.addListener(function(msg) {
  if (msg.question === "Who's there?") {
    port.postMessage({answer: "Madame"});
  } else if (msg.question === "Madame who?") {
    port.postMessage({answer: "Madame... Bovary"});
  }
});
port.postMessage({joke: "Knock knock"});
```

---

## chrome.permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions

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

## chrome.fileSystemProvider Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/fileSystemProvider

**Contents:**
- chrome.fileSystemProvider Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Overview
- Mounting file systems
- Configuring file systems
- Life cycle
- Types
  - AbortRequestedOptions

Important: This API works only on ChromeOS.

Description Use the chrome.fileSystemProvider API to create file systems, that can be accessible from the file manager on Chrome OS.

Use the chrome.fileSystemProvider API to create file systems, that can be accessible from the file manager on Chrome OS.

Permissions fileSystemProvider

Availability ChromeOS only

You must declare the "fileSystemProvider" permission and section in the extension manifest to use the File System Provider API. For example:

The file_system_provider section must be declared as follows:

Files app uses above information in order to render related UI elements appropriately. For example, if configurable is set to true, then a menu item for configuring volumes will be rendered. Similarly, if multiple_mounts is set to true, then Files app will allow to add more than one mount points from the UI. If watchable is false, then a refresh button will be rendered. Note, that if possible you should add support for watchers, so changes on the file system can be reflected immediately and automatically.

File System Provider API allows extensions to support virtual file systems, which are available in the file manager on ChromeOS. Use cases include decompressing archives and accessing files in a cloud service other than Drive.

Providing extensions can either provide file system contents from an external source (such as a remote server or a USB device), or using a local file (such as an archive) as its input.

In order to write file systems which are file handlers (source is "file") the provider must be a packaged app, as the onLaunched event is not available to extensions.

If the source is network or a device, then the file system should be mounted when onMountRequested event is called.

Provided file systems once mounted can be configured via the onConfigureRequested event. It's especially useful for file systems which provide contents via network in order to set proper credentials. Handling this event is optional.

Provided file systems once mounted are remembered by Chrome and remounted automatically after reboot or restart. Hence, once a file system is mounted by a providing extension, it will stay until either the extension is unloaded, or the extension calls the unmount method.

Types AbortRequestedOptions Properties fileSystemId string The identifier of the file system related to this operation. operationRequestId number An ID of the request to be aborted. requestId number The unique identi

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "fileSystemProvider"
  ],
  ...
  "file_system_provider_capabilities": {
    "configurable": true,
    "watchable": false,
    "multiple_mounts": true,
    "source": "network"
  },
  ...
}
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#favicon

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## chrome.tabs Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/tabs

**Contents:**
- chrome.tabs Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Use cases
  - Open an extension page in a new tab
  - Get the current tab
  - Mute the specified tab
  - Move the current tab to the first position when clicked
  - Pass a message to a selected tab's content script
- Extension examples

Description Use the chrome.tabs API to interact with the browser's tab system. You can use this API to create, modify, and rearrange tabs in the browser.

Use the chrome.tabs API to interact with the browser's tab system. You can use this API to create, modify, and rearrange tabs in the browser.

The Tabs API not only offers features for manipulating and managing tabs, but can also detect the language of the tab, take a screenshot, and communicate with a tab's content scripts.

Most features don't require any permissions to use. For example: creating a new tab, reloading a tab, navigating to another URL, etc.

There are three permissions developers should be aware of when working with the Tabs API.

This permission does not give access to the chrome.tabs namespace. Instead, it grants an extension the ability to call tabs.query() against four sensitive properties on tabs.Tab instances: url, pendingUrl, title, and favIconUrl.

Host permissions allow an extension to read and query a matching tab's four sensitive tabs.Tab properties. They can also interact directly with the matching tabs using methods such as tabs.captureVisibleTab(), scripting.executeScript(), scripting.insertCSS(), and scripting.removeCSS().

activeTab grants an extension temporary host permission for the current tab in response to a user invocation. Unlike host permissions, activeTab does not trigger any warnings.

The following sections demonstrate some common use cases.

A common pattern for extensions is to open an onboarding page in a new tab when the extension is installed. The following example shows how to do this.

This example demonstrates how an extension's service worker can retrieve the active tab from the currently-focused window (or most recently-focused window, if no Chrome windows are focused). This can usually be thought of as the user's current tab.

This example shows how an extension can toggle the muted state for a given tab.

This example shows how to move a tab while a drag may or may not be in progress. While this example uses chrome.tabs.move, you can use the same waiting pattern for other calls that modify tabs while a drag is in progress.

This example demonstrates how an extension's service worker can communicate with content scripts in specific browser tabs using tabs.sendMessage().

For more Tabs API extensions demos, explore any of the following:

Types MutedInfo Chrome 46+ The tab's muted state and the reason for the last state change. Properties extensionId 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "tabs"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "host_permissions": [
    "http://*/*",
    "https://*/*"
  ],
  ...
}
```

Example 3 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "activeTab"
  ],
  ...
}
```

Example 4 (javascript):
```javascript
chrome.runtime.onInstalled.addListener(({reason}) => {
  if (reason === 'install') {
    chrome.tabs.create({
      url: "onboarding.html"
    });
  }
});
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#storage

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## chrome.i18n Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/i18n

**Contents:**
- chrome.i18n Stay organized with collections Save and categorize content based on your preferences.
- Description
- Manifest
- Concepts and usage
  - Support multiple languages
  - Predefined messages
  - Locales
  - Search for messages
  - Set your browser's locale
    - Windows

Description Use the chrome.i18n infrastructure to implement internationalization across your whole app or extension.

Use the chrome.i18n infrastructure to implement internationalization across your whole app or extension.

If an extension has a /_locales directory, the manifest must define "default_locale".

You need to put all of its user-visible strings into a file named messages.json. Each time you add a new locale, you add a messages file under a directory named /_locales/_localeCode_, where localeCode is a code such as en for English.

Here's the file hierarchy for an internationalized extension that supports English (en), Spanish (es), and Korean (ko):

Say you have an extension with the files shown in the following figure:

To internationalize this extension, you name each user-visible string and put it into a messages file. The extension's manifest, CSS files, and JavaScript code use each string's name to get its localized version.

Here's what the extension looks like when it's internationalized (note that it still has only English strings):

Some notes about internationalizing:

In manifest.json and CSS files, refer to a string named messagename like this:

In your extension or app's JavaScript code, refer to a string named messagename like this:

In each call to getMessage(), you can supply up to 9 strings to be included in the message. See Examples: getMessage for details.

Some messages, such as @@bidi_dir and @@ui_locale, are provided by the internationalization system. See the Predefined messages section for a full list of predefined message names.

In messages.json, each user-visible string has a name, a "message" item, and an optional "description" item. The name is a key such as "extName" or "search_string" that identifies the string. The "message" specifies the value of the string in this locale. The optional "description" provides help to translators, who might not be able to see how the string is used in your extension. For example:

For more information, see Formats: Locale-Specific Messages.

Once an extension is internationalized, translating it is straightforward. You copy messages.json, translate it, and put the copy into a new directory under /_locales. For example, to support Spanish, just put a translated copy of messages.json under /_locales/es. The following figure shows the previous extension with a new Spanish translation.

The internationalization system provides a few predefined messages to help you localize. These inclu

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
__MSG_messagename__
```

Example 2 (unknown):
```unknown
chrome.i18n.getMessage("messagename")
```

Example 3 (unknown):
```unknown
{
  "search_string": {
    "message": "hello%20world",
    "description": "The string we search for. Put %20 between words that go together."
  },
  ...
}
```

Example 4 (unknown):
```unknown
body {
  background-image:url('chrome-extension://__MSG_@@extension_id__/background.png');
}
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#webNavigation

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## chrome.sidePanel Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/sidePanel

**Contents:**
- chrome.sidePanel Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Concepts and usage
  - Use cases
    - Display the same side panel on every site
    - Enable a side panel on a specific site
    - Open the side panel by clicking the toolbar icon
    - Programmatically open the side panel on user interaction

Description Use the chrome.sidePanel API to host content in the browser's side panel alongside the main content of a webpage.

Use the chrome.sidePanel API to host content in the browser's side panel alongside the main content of a webpage.

Permissions sidePanel

To use the Side Panel API, add the "sidePanel" permission in the extension manifest file:

Availability Chrome 114+ MV3+

The Side Panel API allows extensions to display their own UI in the side panel, enabling persistent experiences that complement the user's browsing journey.

Some features include:

The following sections demonstrate some common use cases for the Side Panel API. See Extension samples for complete extension examples.

The side panel can be set initially from the "default_path" property in the "side_panel" key of the manifest to display the same side panel on every site. This should point to a relative path within the extension directory.

An extension can use sidepanel.setOptions() to enable a side panel on a specific tab. This example uses chrome.tabs.onUpdated() to listen for any updates made to the tab. It checks if the URL is www.google.com and enables the side panel. Otherwise, it disables it.

When a user temporarily switches to a tab where the side panel is not enabled, the side panel will be hidden. It will automatically show again when the user switches to a tab where it was previously open.

When the user navigates to a site where the side panel is not enabled, the side panel will close, and the extension won't show in the side panel drop-down menu.

For a complete example, see the Tab-specific side panel sample.

Developers can allow users to open the side panel when they click the action toolbar icon with sidePanel.setPanelBehavior(). First, declare the "action" key in the manifest:

Now, add this code to the previous example:

Chrome 116 introduces sidePanel.open(). It allows extensions to open the side panel through an extension user gesture, such as clicking on the action icon. Or a user interaction on an extension page or content script, such as clicking a button. For a complete demo, see the Open Side Panel sample extension.

The following code shows how to open a global side panel on the current window when the user clicks on a context menu. When using sidePanel.open(), you must choose the context in which it should open. Use windowId to open a global side panel. Alternatively, set the tabId to open the side panel only on a specific tab.

Extensions can use si

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My side panel extension",
  ...
  "permissions": [
    "sidePanel"
  ]
}
```

Example 2 (unknown):
```unknown
{
  "name": "My side panel extension",
  ...
  "side_panel": {
    "default_path": "sidepanel.html"
  }
  ...
}
```

Example 3 (unknown):
```unknown
<!DOCTYPE html>
<html>
  <head>
    <title>My Sidepanel</title>
  </head>
  <body>
    <h1>All sites sidepanel extension</h1>
    <p>This side panel is enabled on all sites</p>
  </body>
</html>
```

Example 4 (javascript):
```javascript
const GOOGLE_ORIGIN = 'https://www.google.com';

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url) return;
  const url = new URL(tab.url);
  // Enables the side panel on google.com
  if (url.origin === GOOGLE_ORIGIN) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true
    });
  } else {
    // Disables the side panel on all other sites
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false
    });
  }
});
```

---

## chrome.windows Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/windows

**Contents:**
- chrome.windows Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Concepts and usage
  - The current window
- Examples
- Types
  - CreateType
    - Enum
  - QueryOptions

Description Use the chrome.windows API to interact with browser windows. You can use this API to create, modify, and rearrange windows in the browser.

Use the chrome.windows API to interact with browser windows. You can use this API to create, modify, and rearrange windows in the browser.

When requested, a windows.Window contains an array of tabs.Tab objects. You must declare the "tabs" permission in your manifest if you need access to the url, pendingUrl, title, or favIconUrl properties of tabs.Tab. For example:

Many functions in the extension system take an optional windowId argument, which defaults to the current window.

The current window is the window that contains the code that is currently executing. It's important to realize that this can be different from the topmost or focused window.

For example, say an extension creates a few tabs or windows from a single HTML file, and that the HTML file contains a call to tabs.query(). The current window is the window that contains the page that made the call, no matter what the topmost window is.

In the case of service workers, the value of the current window falls back to the last active window. Under some circumstances, there may be no current window for background pages.

To try this API, install the windows API example from the chrome-extension-samples repository.

Types CreateType Chrome 44+ Specifies what type of browser window to create. 'panel' is deprecated and is available only to existing allowlisted extensions on Chrome OS. Enum "normal" Specifies the window as a standard window."popup" Specifies the window as a popup window."panel" Specifies the window as a panel. QueryOptions Chrome 88+ Properties populate boolean optional If true, the windows.Window object has a tabs property that contains a list of the tabs.Tab objects. The Tab objects only contain the url, pendingUrl, title, and favIconUrl properties if the extension's manifest file includes the "tabs" permission. windowTypes WindowType[] optional If set, the windows.Window returned is filtered based on its type. If unset, the default filter is set to ['normal', 'popup']. Window Properties alwaysOnTop boolean Whether the window is set to be always on top. focused boolean Whether the window is currently the focused window. height number optional The height of the window, including the frame, in pixels. In some circumstances a window may not be assigned a height property; for example, when querying closed windows from the sessions API. i

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": ["tabs"],
  ...
}
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#scripting

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## chrome.scripting Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/scripting#properties_4

**Contents:**
- chrome.scripting Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Concepts and usage
  - Injection targets
  - Injected code
    - Files
    - Runtime functions

Description Use the chrome.scripting API to execute script in different contexts.

Use the chrome.scripting API to execute script in different contexts.

Permissions scripting

Availability Chrome 88+ MV3+

To use the chrome.scripting API, declare the "scripting" permission in the manifest plus the host permissions for the pages to inject scripts into. Use the "host_permissions" key or the "activeTab" permission, which grants temporary host permissions. The following example uses the activeTab permission.

You can use the chrome.scripting API to inject JavaScript and CSS into websites. This is similar to what you can do with content scripts. But by using the chrome.scripting namespace, extensions can make decisions at runtime.

You can use the target parameter to specify a target to inject JavaScript or CSS into.

The only required field is tabId. By default, an injection will run in the main frame of the specified tab.

To run in all frames of the specified tab, you can set the allFrames boolean to true.

You can also inject into specific frames of a tab by specifying individual frame IDs. For more information on frame IDs, see the chrome.webNavigation API.

Extensions can specify the code to be injected either via an external file or a runtime variable.

Files are specified as strings that are paths relative to the extension's root directory. The following code will inject the file script.js into the main frame of the tab.

When injecting JavaScript with scripting.executeScript(), you can specify a function to be executed instead of a file. This function should be a function variable available to the current extension context.

You can work around this by using the args property:

If injecting CSS within a page, you can also specify a string to be used in the css property. This option is only available for scripting.insertCSS(); you can't execute a string using scripting.executeScript().

The results of executing JavaScript are passed to the extension. A single result is included per-frame. The main frame is guaranteed to be the first index in the resulting array; all other frames are in a non-deterministic order.

scripting.insertCSS() does not return any results.

If the resulting value of the script execution is a promise, Chrome will wait for the promise to settle and return the resulting value.

The following snippet contains a function that unregisters all dynamic content scripts the extension has previously registered.

To try the chrome.scripting

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Scripting Extension",
  "manifest_version": 3,
  "permissions": ["scripting", "activeTab"],
  ...
}
```

Example 2 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId()},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected"));
```

Example 3 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), allFrames : true},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected in all frames"));
```

Example 4 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), frameIds : [ frameId1, frameId2 ]},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected on target frames"));
```

---

## The Prompt API Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/ai/prompt-api#multimodal_capabilities

**Contents:**
- The Prompt API Stay organized with collections Save and categorize content based on your preferences.
  - Review the hardware requirements
- Use the Prompt API
  - Model parameters
  - Create a session
  - Add context with initial prompts
    - Constrain responses with a prefix
  - Add expected input and output
    - Multimodal capabilities
  - Append messages

Thomas Steiner GitHub LinkedIn Mastodon Bluesky Homepage Alexandra Klepper GitHub Bluesky

Published: May 20, 2025, Last updated: September 21, 2025

Published: May 20, 2025, Last updated: September 21, 2025

With the Prompt API, you can send natural language requests to Gemini Nano in the browser.

There are many ways you can use the Prompt API. For example, you could build:

These are just a few possibilities, and we're excited to see what you create.

The following requirements exist for developers and the users who operate features using these APIs in Chrome. Other browsers may have different operating requirements.

The Language Detector and Translator APIs work in Chrome on desktop. These APIs do not work on mobile devices. The Prompt API, Summarizer API, Writer API, Rewriter API, and Proofreader API work in Chrome when the following conditions are met:

Gemini Nano's exact size may vary as the browser updates the model. To determine the current size, visit chrome://on-device-internals.

The Prompt API uses the Gemini Nano model in Chrome. While the API is built into Chrome, the model is downloaded separately the first time an origin uses the API. Before you use this API, acknowledge Google's Generative AI Prohibited Uses Policy.

To determine if the model is ready to use, call LanguageModel.availability().

To trigger the download and instantiate the language model, check for user activation. Then, call the create() function.

If the response to availability() was downloading, listen for download progress and inform the user, as the download may take time.

The params() function informs you of the language model's parameters. The object has the following fields:

Once the Prompt API can run, you create a session with the create() function.

Each session can be customized with topK and temperature using an optional options object. The default values for these parameters are returned from LanguageModel.params().

The create() function's optional options object also takes a signal field, which lets you pass an AbortSignal to destroy the session.

With initial prompts, you can provide the language model with context about previous interactions, for example, to allow the user to resume a stored session after a browser restart.

You can add an "assistant" role, in addition to previous roles, to elaborate on the model's previous responses. For example:

In some cases, instead of requesting a new response, you may want to prefill part of the "assistant"-rol

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
const availability = await LanguageModel.availability();
```

Example 2 (javascript):
```javascript
const session = await LanguageModel.create({
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloaded ${e.loaded * 100}%`);
    });
  },
});
```

Example 3 (unknown):
```unknown
await LanguageModel.params();
// {defaultTopK: 3, maxTopK: 128, defaultTemperature: 1, maxTemperature: 2}
```

Example 4 (javascript):
```javascript
const params = await LanguageModel.params();
// Initializing a new session must either specify both `topK` and
// `temperature` or neither of them.
const slightlyHighTemperatureSession = await LanguageModel.create({
  temperature: Math.max(params.defaultTemperature * 1.2, 2.0),
  topK: params.defaultTopK,
});
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#activeTab

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## chrome.runtime Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/runtime#method-requestUpdateCheck

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

## chrome.sidePanel Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/sidePanel#method-getLayout

**Contents:**
- chrome.sidePanel Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Concepts and usage
  - Use cases
    - Display the same side panel on every site
    - Enable a side panel on a specific site
    - Open the side panel by clicking the toolbar icon
    - Programmatically open the side panel on user interaction

Description Use the chrome.sidePanel API to host content in the browser's side panel alongside the main content of a webpage.

Use the chrome.sidePanel API to host content in the browser's side panel alongside the main content of a webpage.

Permissions sidePanel

To use the Side Panel API, add the "sidePanel" permission in the extension manifest file:

Availability Chrome 114+ MV3+

The Side Panel API allows extensions to display their own UI in the side panel, enabling persistent experiences that complement the user's browsing journey.

Some features include:

The following sections demonstrate some common use cases for the Side Panel API. See Extension samples for complete extension examples.

The side panel can be set initially from the "default_path" property in the "side_panel" key of the manifest to display the same side panel on every site. This should point to a relative path within the extension directory.

An extension can use sidepanel.setOptions() to enable a side panel on a specific tab. This example uses chrome.tabs.onUpdated() to listen for any updates made to the tab. It checks if the URL is www.google.com and enables the side panel. Otherwise, it disables it.

When a user temporarily switches to a tab where the side panel is not enabled, the side panel will be hidden. It will automatically show again when the user switches to a tab where it was previously open.

When the user navigates to a site where the side panel is not enabled, the side panel will close, and the extension won't show in the side panel drop-down menu.

For a complete example, see the Tab-specific side panel sample.

Developers can allow users to open the side panel when they click the action toolbar icon with sidePanel.setPanelBehavior(). First, declare the "action" key in the manifest:

Now, add this code to the previous example:

Chrome 116 introduces sidePanel.open(). It allows extensions to open the side panel through an extension user gesture, such as clicking on the action icon. Or a user interaction on an extension page or content script, such as clicking a button. For a complete demo, see the Open Side Panel sample extension.

The following code shows how to open a global side panel on the current window when the user clicks on a context menu. When using sidePanel.open(), you must choose the context in which it should open. Use windowId to open a global side panel. Alternatively, set the tabId to open the side panel only on a specific tab.

Extensions can use si

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My side panel extension",
  ...
  "permissions": [
    "sidePanel"
  ]
}
```

Example 2 (unknown):
```unknown
{
  "name": "My side panel extension",
  ...
  "side_panel": {
    "default_path": "sidepanel.html"
  }
  ...
}
```

Example 3 (unknown):
```unknown
<!DOCTYPE html>
<html>
  <head>
    <title>My Sidepanel</title>
  </head>
  <body>
    <h1>All sites sidepanel extension</h1>
    <p>This side panel is enabled on all sites</p>
  </body>
</html>
```

Example 4 (javascript):
```javascript
const GOOGLE_ORIGIN = 'https://www.google.com';

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url) return;
  const url = new URL(tab.url);
  // Enables the side panel on google.com
  if (url.origin === GOOGLE_ORIGIN) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true
    });
  } else {
    // Disables the side panel on all other sites
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false
    });
  }
});
```

---

## chrome.storage Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/storage/

**Contents:**
- chrome.storage Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Concepts and usage
  - Can extensions use web storage APIs?
  - Storage areas
  - Storage and throttling limits
- Use cases
  - Respond to storage updates
  - Asynchronous preload from storage

Description Use the chrome.storage API to store, retrieve, and track changes to user data.

Use the chrome.storage API to store, retrieve, and track changes to user data.

To use the storage API, declare the "storage" permission in the extension manifest. For example:

The Storage API provides an extension-specific way to persist user data and state. It's similar to the web platform's storage APIs (IndexedDB, and Storage), but was designed to meet the storage needs of extensions. The following are a few key features:

While extensions can use the Storage interface (accessible from window.localStorage) in some contexts (popup and other HTML pages), we don't recommend it for the following reasons:

To move data from web storage APIs to extension storage APIs from a service worker:

There are also some nuances to how web storage APIs work in extensions. Learn more in the Storage and Cookies article.

The Storage API is divided into the following storage areas:

The Storage API has the following usage limitations:

For details on storage area limitations and what happens when they're exceeded, see the quota information for sync, local, and session.

The following sections demonstrate common use cases for the Storage API.

To track changes made to storage, add a listener to its onChanged event. When anything changes in storage, that event fires. The sample code listens for these changes:

We can take this idea even further. In this example, we have an options page that allows the user to toggle a "debug mode" (implementation not shown here). The options page immediately saves the new settings to storage.sync, and the service worker uses storage.onChanged to apply the setting as soon as possible.

Because service workers don't run all the time, Manifest V3 extensions sometimes need to asynchronously load data from storage before they execute their event handlers. To do this, the following snippet uses an async action.onClicked event handler that waits for the storageCache global to be populated before executing its logic.

You can view and edit data stored using the API in DevTools. To learn more, see the View and edit extension storage page in the DevTools documentation.

The following samples demonstrate the local, sync, and session storage areas:

To see other demos of the Storage API, explore any of the following samples:

Types AccessLevel Chrome 102+ The storage area's access level. Enum "TRUSTED_CONTEXTS" Specifies contexts originating from the extension 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "storage"
  ],
  ...
}
```

Example 2 (javascript):
```javascript
chrome.storage.onChanged.addListener((changes, namespace) => {
  for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
    console.log(
      `Storage key "${key}" in namespace "${namespace}" changed.`,
      `Old value was "${oldValue}", new value is "${newValue}".`
    );
  }
});
```

Example 3 (unknown):
```unknown
<!-- type="module" allows you to use top level await -->
<script defer src="options.js" type="module"></script>
<form id="optionsForm">
  <label for="debug">
    <input type="checkbox" name="debug" id="debug">
    Enable debug mode
  </label>
</form>
```

Example 4 (javascript):
```javascript
// In-page cache of the user's options
const options = {};
const optionsForm = document.getElementById("optionsForm");

// Immediately persist options changes
optionsForm.debug.addEventListener("change", (event) => {
  options.debug = event.target.checked;
  chrome.storage.sync.set({ options });
});

// Initialize the form with the user's option settings
const data = await chrome.storage.sync.get("options");
Object.assign(options, data.options);
optionsForm.debug.checked = Boolean(options.debug);
```

---

## chrome.devtools.network Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/devtools/network

**Contents:**
- chrome.devtools.network Stay organized with collections Save and categorize content based on your preferences.
- Description
- Manifest
- Examples
- Types
  - Request
    - Properties
- Methods
  - getHAR()
    - Parameters

Description Use the chrome.devtools.network API to retrieve the information about network requests displayed by the Developer Tools in the Network panel.

Use the chrome.devtools.network API to retrieve the information about network requests displayed by the Developer Tools in the Network panel.

Network requests information is represented in the HTTP Archive format (HAR). The description of HAR is outside of scope of this document, refer to HAR v1.2 Specification.

In terms of HAR, the chrome.devtools.network.getHAR() method returns entire HAR log, while chrome.devtools.network.onRequestFinished event provides HAR entry as an argument to the event callback.

Note that request content is not provided as part of HAR for efficiency reasons. You may call request's getContent() method to retrieve content.

If the Developer Tools window is opened after the page is loaded, some requests may be missing in the array of entries returned by getHAR(). Reload the page to get all requests. In general, the list of requests returned by getHAR() should match that displayed in the Network panel.

See DevTools APIs summary for general introduction to using Developer Tools APIs.

Manifest The following keys must be declared in the manifest to use this API."devtools_page"

The following keys must be declared in the manifest to use this API.

The following code logs URLs of all images larger than 40KB as they are loaded:

To try this API, install the devtools API examples from the chrome-extension-samples repository.

Types Request Represents a network request for a document resource (script, image and so on). See HAR Specification for reference. Properties getContent void Returns content of the response body. The getContent function looks like: (callback: function) => {...} callback function The callback parameter looks like: (content: string, encoding: string) => void content string Content of the response body (potentially encoded). encoding string Empty if content is not encoded, encoding name otherwise. Currently, only base64 is supported. Methods getHAR() chrome.devtools.network.getHAR( callback: function,): void Returns HAR log that contains all known network requests. Parameters callback function The callback parameter looks like: (harLog: object) => void harLog object A HAR log. See HAR specification for details. Events onNavigated chrome.devtools.network.onNavigated.addListener( callback: function,) Fired when the inspected window navigates to a new page. Parameters 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
chrome.devtools.network.onRequestFinished.addListener(
  function(request) {
    if (request.response.bodySize > 40*1024) {
      chrome.devtools.inspectedWindow.eval(
          'console.log("Large image: " + unescape("' +
          escape(request.request.url) + '"))');
    }
  }
);
```

---

## chrome.storage Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/storage

**Contents:**
- chrome.storage Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Concepts and usage
  - Can extensions use web storage APIs?
  - Storage areas
  - Storage and throttling limits
- Use cases
  - Respond to storage updates
  - Asynchronous preload from storage

Description Use the chrome.storage API to store, retrieve, and track changes to user data.

Use the chrome.storage API to store, retrieve, and track changes to user data.

To use the storage API, declare the "storage" permission in the extension manifest. For example:

The Storage API provides an extension-specific way to persist user data and state. It's similar to the web platform's storage APIs (IndexedDB, and Storage), but was designed to meet the storage needs of extensions. The following are a few key features:

While extensions can use the Storage interface (accessible from window.localStorage) in some contexts (popup and other HTML pages), we don't recommend it for the following reasons:

To move data from web storage APIs to extension storage APIs from a service worker:

There are also some nuances to how web storage APIs work in extensions. Learn more in the Storage and Cookies article.

The Storage API is divided into the following storage areas:

The Storage API has the following usage limitations:

For details on storage area limitations and what happens when they're exceeded, see the quota information for sync, local, and session.

The following sections demonstrate common use cases for the Storage API.

To track changes made to storage, add a listener to its onChanged event. When anything changes in storage, that event fires. The sample code listens for these changes:

We can take this idea even further. In this example, we have an options page that allows the user to toggle a "debug mode" (implementation not shown here). The options page immediately saves the new settings to storage.sync, and the service worker uses storage.onChanged to apply the setting as soon as possible.

Because service workers don't run all the time, Manifest V3 extensions sometimes need to asynchronously load data from storage before they execute their event handlers. To do this, the following snippet uses an async action.onClicked event handler that waits for the storageCache global to be populated before executing its logic.

You can view and edit data stored using the API in DevTools. To learn more, see the View and edit extension storage page in the DevTools documentation.

The following samples demonstrate the local, sync, and session storage areas:

To see other demos of the Storage API, explore any of the following samples:

Types AccessLevel Chrome 102+ The storage area's access level. Enum "TRUSTED_CONTEXTS" Specifies contexts originating from the extension 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "storage"
  ],
  ...
}
```

Example 2 (javascript):
```javascript
chrome.storage.onChanged.addListener((changes, namespace) => {
  for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
    console.log(
      `Storage key "${key}" in namespace "${namespace}" changed.`,
      `Old value was "${oldValue}", new value is "${newValue}".`
    );
  }
});
```

Example 3 (unknown):
```unknown
<!-- type="module" allows you to use top level await -->
<script defer src="options.js" type="module"></script>
<form id="optionsForm">
  <label for="debug">
    <input type="checkbox" name="debug" id="debug">
    Enable debug mode
  </label>
</form>
```

Example 4 (javascript):
```javascript
// In-page cache of the user's options
const options = {};
const optionsForm = document.getElementById("optionsForm");

// Immediately persist options changes
optionsForm.debug.addEventListener("change", (event) => {
  options.debug = event.target.checked;
  chrome.storage.sync.set({ options });
});

// Initialize the form with the user's option settings
const data = await chrome.storage.sync.get("options");
Object.assign(options, data.options);
optionsForm.debug.checked = Boolean(options.debug);
```

---

## Permission warning guidelines Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/permission_warnings

**Contents:**
- Permission warning guidelines Stay organized with collections Save and categorize content based on your preferences.
- Best practices
- View warnings
  - Use the Extension Update Testing Tool
  - By manually packing the extension
- Update permissions
  - Update using the Extension Update Testing Tool
  - Update your extension manually

Chrome extensions enhance the user's browser experience. To do this extensions use Chrome APIs that require certain permissions. Some permissions are less intrusive and don't display a warning. Other permissions trigger a warning that users have to allow. This page provides guidelines for working with permission warnings. Specific warnings are noted in the Permissions under the permission to which they apply.

When a new permission that triggers a warning is added, the extension will be disabled until the user accepts the new permission. See Updating permissions to learn how to test this behavior.

Some permissions may not display warnings when paired with other permissions. For example, the "tabs" warning won't show if the extension also requests "<all_urls>".

Permission warnings describe the capabilities an API grants, but some warnings are harder to understand than others. Users are more likely to install extensions that follow these guidelines:

To view an extension's permission warnings, you have the following options:

Click the Pack Extension button.

Chrome will create two files, a .crx file and a .pem file. The .pem file contains the private key used to sign the extension. Make sure you remember which directory these files were saved.

Keep the .pem file in a secret and secure place; it will be needed to update the extension.

Install the .crx file by dropping it into the Extension's Management page.

After dropping the .crx file the browser will ask if the extension can be added and display warnings.

When an extension adds a new permission that triggers a warning it may temporarily disable it. The extension will be re-enabled only after the user agrees to accept the new permission.

To check if your extension will be disabled when adding a new permission, you have the following options:

These steps assume you followed the Using the Extension Update Testing Tool instructions to start the server.

You will see a dialog that prompts the user to accept the new permissions.

Figure 9: Disabled extension warning

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2024-02-05 UTC.

---

## Declare permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions

**Contents:**
- Declare permissions Stay organized with collections Save and categorize content based on your preferences.
- Manifest
- Host permissions
- Permissions with warnings
- Allow access
  - Allow access to file URLs and incognito pages

To use most extension APIs and features, you must declare your extension's intent in the manifest's permissions fields. Extensions can request the following categories of permissions, specified using the respective manifest keys:

Permissions help to limit damage if your extension is compromised by malware. Some permission warning are displayed to users for their consent before installation or at runtime, as detailed in Permission with warnings.

Consider using optional permissions wherever the functionality of your extension permits, to provide users with informed control over access to resources and data.

If an API requires a permission, its documentation explains how to declare it. For an example, see Storage API.

The following is an example of the permissions section of a manifest file:

Host permissions allow extensions to interact with the URL's matching patterns. Some Chrome APIs require host permissions in addition to their own API permissions, which are documented on each reference page. Here are some examples:

When an extension requests multiple permissions, and many of them display warnings on installation, the user will see a list of warnings, like in the following example:

Users are more likely to trust an extension with limited warnings or when permissions are explained to them. Consider implementing optional permissions or a less powerful API to avoid alarming warnings. For best practices for warnings, see Permission warnings guidelines. Specific warnings are listed with the permissions to which they apply in the Permissions reference list.

Adding or changing match patterns in the "host_permissions" and "content_scripts.matches" fields of the manifest filewill also trigger a warning. To learn more, see Updating permissions.

If your extension needs to run on file:// URLs or operate in incognito mode, users must give the extension access on its details page. You can find instructions for opening the details page under Manage your extensions.

Choose Manage Extension.

Scroll down to enable access to file URLs or incognito mode.

To detect whether the user has allowed access, you can call extension.isAllowedIncognitoAccess() or extension.isAllowedFileSchemeAccess().

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/o

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Permissions Extension",
  ...
  "permissions": [
    "activeTab",
    "contextMenus",
    "storage"
  ],
  "optional_permissions": [
    "topSites",
  ],
  "host_permissions": [
    "https://www.developer.chrome.com/*"
  ],
  "optional_host_permissions":[
    "https://*/*",
    "http://*/*"
  ],
  ...
  "manifest_version": 3
}
```

---

## chrome.scripting Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/scripting#type-ExecutionWorld

**Contents:**
- chrome.scripting Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Concepts and usage
  - Injection targets
  - Injected code
    - Files
    - Runtime functions

Description Use the chrome.scripting API to execute script in different contexts.

Use the chrome.scripting API to execute script in different contexts.

Permissions scripting

Availability Chrome 88+ MV3+

To use the chrome.scripting API, declare the "scripting" permission in the manifest plus the host permissions for the pages to inject scripts into. Use the "host_permissions" key or the "activeTab" permission, which grants temporary host permissions. The following example uses the activeTab permission.

You can use the chrome.scripting API to inject JavaScript and CSS into websites. This is similar to what you can do with content scripts. But by using the chrome.scripting namespace, extensions can make decisions at runtime.

You can use the target parameter to specify a target to inject JavaScript or CSS into.

The only required field is tabId. By default, an injection will run in the main frame of the specified tab.

To run in all frames of the specified tab, you can set the allFrames boolean to true.

You can also inject into specific frames of a tab by specifying individual frame IDs. For more information on frame IDs, see the chrome.webNavigation API.

Extensions can specify the code to be injected either via an external file or a runtime variable.

Files are specified as strings that are paths relative to the extension's root directory. The following code will inject the file script.js into the main frame of the tab.

When injecting JavaScript with scripting.executeScript(), you can specify a function to be executed instead of a file. This function should be a function variable available to the current extension context.

You can work around this by using the args property:

If injecting CSS within a page, you can also specify a string to be used in the css property. This option is only available for scripting.insertCSS(); you can't execute a string using scripting.executeScript().

The results of executing JavaScript are passed to the extension. A single result is included per-frame. The main frame is guaranteed to be the first index in the resulting array; all other frames are in a non-deterministic order.

scripting.insertCSS() does not return any results.

If the resulting value of the script execution is a promise, Chrome will wait for the promise to settle and return the resulting value.

The following snippet contains a function that unregisters all dynamic content scripts the extension has previously registered.

To try the chrome.scripting

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Scripting Extension",
  "manifest_version": 3,
  "permissions": ["scripting", "activeTab"],
  ...
}
```

Example 2 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId()},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected"));
```

Example 3 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), allFrames : true},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected in all frames"));
```

Example 4 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), frameIds : [ frameId1, frameId2 ]},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected on target frames"));
```

---

## chrome.contextMenus Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/contextMenus

**Contents:**
- chrome.contextMenus Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Concepts and usage
- Examples
- Types
  - ContextType
    - Enum
  - CreateProperties
    - Properties

Description Use the chrome.contextMenus API to add items to Google Chrome's context menu. You can choose what types of objects your context menu additions apply to, such as images, hyperlinks, and pages.

Use the chrome.contextMenus API to add items to Google Chrome's context menu. You can choose what types of objects your context menu additions apply to, such as images, hyperlinks, and pages.

Permissions contextMenus

You must declare the "contextMenus" permission in your extension's manifest to use the API. Also, you should specify a 16 by 16-pixel icon for display next to your menu item. For example:

Context menu items can appear in any document (or frame within a document), even those with file:// or chrome:// URLs. To control which documents your items can appear in, specify the documentUrlPatterns field when you call the create() or update() methods.

You can create as many context menu items as you need, but if more than one from your extension is visible at once, Google Chrome automatically collapses them into a single parent menu.

To try this API, install the contextMenus API example from the chrome-extension-samples repository.

Types ContextType Chrome 44+ The different contexts a menu can appear in. Specifying 'all' is equivalent to the combination of all other contexts except for 'launcher'. The 'launcher' context is only supported by apps and is used to add menu items to the context menu that appears when clicking the app icon in the launcher/taskbar/dock/etc. Different platforms might put limitations on what is actually supported in a launcher context menu. Enum "all" "page" "frame" "selection" "link" "editable" "image" "video" "audio" "launcher" "browser_action" "page_action" "action" CreateProperties Chrome 123+ Properties of the new context menu item. Properties checked boolean optional The initial state of a checkbox or radio button: true for selected, false for unselected. Only one radio button can be selected at a time in a given group. contexts [ContextType, ...ContextType[]] optional List of contexts this menu item will appear in. Defaults to ['page']. documentUrlPatterns string[] optional Restricts the item to apply only to documents or frames whose URL matches one of the given patterns. For details on pattern formats, see Match Patterns. enabled boolean optional Whether this context menu item is enabled or disabled. Defaults to true. id string optional The unique ID to assign to this item. Mandatory for event pages. Cannot be th

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "contextMenus"
  ],
  "icons": {
    "16": "icon-bitty.png",
    "48": "icon-small.png",
    "128": "icon-large.png"
  },
  ...
}
```

---

## What's new in Chrome extensions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/whats-new#chrome_140_new_sidepanelgetlayout_api

**Contents:**
- What's new in Chrome extensions Stay organized with collections Save and categorize content based on your preferences.
- Chrome 140: New sidePanel.getLayout() API
- New guide: the extensions update lifecycle
- Chrome 139: Removing --extensions-on-chrome-urls and --disable-extensions-except flags in Chrome branded builds
- Chrome 138: Changes to the new tab page
- Blog post: Update your extensions ahead of upcoming bookmark changes
- Blog post: What's happening in Chrome Extensions, June 2025
- Video: Whack-a-Mole in your browser - Is it possible!?
- Video: Chrome's new extensions menu explained
- Video: Extensions are Neat!

Check this page often to learn about changes to Chrome extensions, extensions documentation, or related policy or other changes. You'll find other notices posted on the Chrome Extensions Mailing List. The Chrome schedule lists stable and beta release dates.

Posted on September 10, 2025

Starting in Chrome 140, use the new sidePanel.getLayout() API to determine if the side panel is positioned on the left or right of the screen. This is particularly useful if you support RTL languages where the default for new Chrome installations is different.

Posted on Sept 09, 2025

We published a new guide explaining how extensions are updated in Chrome.

Posted on June 30, 2025

Starting in Chrome 139, the --extensions-on-chrome-urls and --disable-extensions-except command-line flags will be removed in official Chrome branded builds. Learn more on the mailing list.

Posted on June 17, 2025

Starting in Chrome 138, we are updating the new tab page UI with a new footer. You can learn more on the mailing list.

Posted on June 17, 2025

We're making some changes to bookmarks sync that may impact your extension. Learn more in the blog post.

Posted on June 6, 2025

We've been busy, with Google I/O and several new features in Chrome and the Chrome Web Store. Get up to speed in What's happening in Chrome Extensions, June 2025!

Posted on April 2, 2025

Discover how you can build a game in the browser in our latest video.

Posted on March 26, 2025

Learn about the experimental new extensions menu in our latest video, Chrome's new extensions menu explained .

Posted on March 21, 2025

Discover how you can get started with extension development in Extensions are Neat episode 1, and just how flexible Chrome customization is with episode 2!

Posted on March 17, 2025

Starting in Chrome 135, a new userScripts.execute() method is available in the chrome.userScripts API. You can use this to inject a user script once at an arbitrary time instead of needing to register it permanently.

Posted on January 14, 2025

Starting in Chrome 132, you can view and edit data stored using the chrome.storage API in DevTools. To learn more, see the new View and edit extension storage page in the DevTools documentation.

Posted on January 2, 2025

At Google I/O 2024, we shared some early designs for upcoming changes to the extensions menu, which give users more control over the sites extensions can access. We're going to start testing these changes soon, beginning with a small percentage of users in 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
"background": {
  "service_worker": "script.js",
  "type": "module"
}
```

---

## chrome.webRequest Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/webRequest

**Contents:**
- chrome.webRequest Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Concepts and usage
  - Life cycle of requests
  - Request IDs
  - Registering event listeners
  - Handling authentication
  - Implementation details
    - web_accessible_resources

Description Use the chrome.webRequest API to observe and analyze traffic and to intercept, block, or modify requests in-flight.

Use the chrome.webRequest API to observe and analyze traffic and to intercept, block, or modify requests in-flight.

Permissions webRequest

You must declare the "webRequest" permission in the extension manifest to use the web request API, along with the necessary host permissions. To intercept a sub-resource request, the extension must have access to both the requested URL and its initiator. For example:

Required to register blocking event handlers. As of Manifest V3, this is only available to policy installed extensions.

webRequestAuthProvider

Required to use the onAuthRequired method. See Handling authentication.

The web request API defines a set of events that follow the life cycle of a web request. You can use these events to observe and analyze traffic. Certain synchronous events will allow you to intercept, block, or modify a request.

The event life cycle for successful requests is illustrated here, followed by event definitions:

The web request API guarantees that for each request, either onCompleted or onErrorOccurred is fired as the final event with one exception: If a request is redirected to a data:// URL, onBeforeRedirect is the last reported event.

* Note that the web request API presents an abstraction of the network stack to the extension. Internally, one URL request can be split into several HTTP requests (for example, to fetch individual byte ranges from a large file) or can be handled by the network stack without communicating with the network. For this reason, the API does not provide the final HTTP headers that are sent to the network. For example, all headers that are related to caching are invisible to the extension.

The following headers are currently not provided to the onBeforeSendHeaders event. This list is not guaranteed to be complete or stable.

Starting from Chrome 79, request header modifications affect Cross-Origin Resource Sharing (CORS) checks. If modified headers for cross-origin requests do not meet the criteria, it will result in sending a CORS preflight to ask the server if such headers can be accepted. If you really need to modify headers in a way to violate the CORS protocol, you need to specify 'extraHeaders' in opt_extraInfoSpec. On the other hand, response header modifications do not work to deceive CORS checks. If you need to deceive the CORS protocol, you also need to specify 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "webRequest"
  ],
  "host_permissions": [
    "*://*.google.com/*"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
var callback = function(details) {...};
var filter = {...};
var opt_extraInfoSpec = [...];
```

Example 3 (unknown):
```unknown
chrome.webRequest.onBeforeRequest.addListener(
    callback, filter, opt_extraInfoSpec);
```

Example 4 (unknown):
```unknown
{
  "permissions": [
    "webRequest",
    "webRequestAuthProvider"
  ]
}
```

---

## Extend DevTools Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/how-to/devtools/extend-devtools

**Contents:**
- Extend DevTools Stay organized with collections Save and categorize content based on your preferences.
- The DevTools page
- Create a DevTools extension
- DevTools UI elements: panels and sidebar panes
- Communicate between extension components
  - Inject a content script
  - Evaluate JavaScript in the inspected window
  - Pass the selected element to a content script
  - Get a reference panel's window
  - Send messages from injected scripts to the DevTools page

DevTools extensions add features to Chrome DevTools by accessing DevTools-specific extension APIs through a DevTools page added to the extension.

The DevTools-specific extension APIs include the following:

When a DevTools window opens, a DevTools extension creates an instance of its DevTools page that exists as long as the window is open. This page has access to the DevTools APIs and extension APIs, and can do the following:

The DevTools page can directly access extensions APIs. This includes being able to communicate with the service worker using message passing.

To create a DevTools page for your extension, add the devtools_page field in the extension manifest:

The devtools_page field must point to an HTML page. Because the DevTools page must be local to your extension, we recommend specifying it using a relative URL.

The members of the chrome.devtools API are available only to the pages loaded within the DevTools window while that window is open. Content scripts and other extension pages don't have access to these APIs.

In addition to the usual extension UI elements, such as browser actions, context menus and popups, a DevTools extension can add UI elements to the DevTools window:

Each panel is its own HTML file, which can include other resources (JavaScript, CSS, images, and so on). To create a basic panel, use the following code:

JavaScript executed in a panel or sidebar pane has access to the same APIs as the DevTools page.

To create a basic sidebar pane, use the following code:

There are several ways to display content in a sidebar pane:

For both setObject() and setExpression(), the pane displays the value as it would appear in the DevTools console. However, setExpression() lets you display DOM elements and arbitrary JavaScript objects, while setObject() only supports JSON objects.

The following sections describe some helpful ways to allow DevTools extension components to communicate with each other.

To inject a content script, use scripting.executeScript():

You can retrieve the tab ID of the inspected window using the inspectedWindow.tabId property.

If a content script has already been injected, you can use messaging APIs to communicate with it.

You can use the inspectedWindow.eval() method to execute JavaScript code in the context of the inspected page. You can invoke the eval() method from a DevTools page, panel, or sidebar pane.

By default, the expression is evaluated in the context of the main frame of the page. inspectedWindo

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": ...
  "version": "1.0",
  "devtools_page": "devtools.html",
  ...
}
```

Example 2 (unknown):
```unknown
chrome.devtools.panels.create("My Panel",
    "MyPanelIcon.png",
    "Panel.html",
    function(panel) {
      // code invoked on panel creation
    }
);
```

Example 3 (unknown):
```unknown
chrome.devtools.panels.elements.createSidebarPane("My Sidebar",
    function(sidebar) {
        // sidebar initialization code here
        sidebar.setObject({ some_data: "Some data to show" });
});
```

Example 4 (unknown):
```unknown
// DevTools page -- devtools.js
chrome.scripting.executeScript({
  target: {
    tabId: chrome.devtools.inspectedWindow.tabId
  },
  files: ["content_script.js"]
});
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#declarativeNetRequestWithHostAccess

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## chrome.alarms Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/alarms

**Contents:**
- chrome.alarms Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Concepts and usage
  - Device sleep
  - Persistence
- Examples
  - Set an alarm
  - Respond to an alarm
- Types

Description Use the chrome.alarms API to schedule code to run periodically or at a specified time in the future.

Use the chrome.alarms API to schedule code to run periodically or at a specified time in the future.

To use the chrome.alarms API, declare the "alarms" permission in the manifest:

To ensure reliable behavior, it is helpful to understand how the API behaves.

Alarms continue to run while a device is sleeping. However, an alarm will not wake up a device. When the device wakes up, any missed alarms will fire. Repeating alarms will fire at most once and then be rescheduled using the specified period starting from when the device wakes, not taking into account any time that has already elapsed since the alarm was originally set to run.

Alarms generally persist until an extension is updated. However, this is not guaranteed, and alarms may be cleared when the browser is restarted. Consequently, consider setting a value in storage when an alarm is created, and then ensure it exists each time your service worker starts up. For example:

The following examples show how to use and respond to an alarm. To try this API, install the Alarm API example from the chrome-extension-samples repository.

The following example sets an alarm in the service worker when the extension is installed:

The following example sets the action toolbar icon based on the name of the alarm that went off.

Types Alarm Properties name string Name of this alarm. periodInMinutes number optional If not null, the alarm is a repeating alarm and will fire again in periodInMinutes minutes. scheduledTime number Time at which this alarm was scheduled to fire, in milliseconds past the epoch (e.g. Date.now() + n). For performance reasons, the alarm may have been delayed an arbitrary amount beyond this. AlarmCreateInfo Properties delayInMinutes number optional Length of time in minutes after which the onAlarm event should fire. periodInMinutes number optional If set, the onAlarm event should fire every periodInMinutes minutes after the initial event specified by when or delayInMinutes. If not set, the alarm will only fire once. when number optional Time at which the alarm should fire, in milliseconds past the epoch (e.g. Date.now() + n). Methods clear() chrome.alarms.clear( name?: string,): Promise<boolean> Clears the alarm with the given name. Parameters name string optional The name of the alarm to clear. Defaults to the empty string. Returns Promise<boolean> Chrome 91+ clearAll() chrome.a

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "alarms"
  ],
  ...
}
```

Example 2 (javascript):
```javascript
const STORAGE_KEY = "user-preference-alarm-enabled";

async function checkAlarmState() {
  const { alarmEnabled } = await chrome.storage.get(STORAGE_KEY);

  if (alarmEnabled) {
    const alarm = await chrome.alarms.get("my-alarm");

    if (!alarm) {
      await chrome.alarms.create({ periodInMinutes: 1 });
    }
  }
}

checkAlarmState();
```

Example 3 (javascript):
```javascript
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') {
    return;
  }

  // Create an alarm so we have something to look at in the demo
  await chrome.alarms.create('demo-default-alarm', {
    delayInMinutes: 1,
    periodInMinutes: 1
  });
});
```

Example 4 (javascript):
```javascript
chrome.alarms.onAlarm.addListener((alarm) => {
  chrome.action.setIcon({
    path: getIconPath(alarm.name),
  });
});
```

---

## chrome.sidePanel Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/sidePanel#use-cases

**Contents:**
- chrome.sidePanel Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Concepts and usage
  - Use cases
    - Display the same side panel on every site
    - Enable a side panel on a specific site
    - Open the side panel by clicking the toolbar icon
    - Programmatically open the side panel on user interaction

Description Use the chrome.sidePanel API to host content in the browser's side panel alongside the main content of a webpage.

Use the chrome.sidePanel API to host content in the browser's side panel alongside the main content of a webpage.

Permissions sidePanel

To use the Side Panel API, add the "sidePanel" permission in the extension manifest file:

Availability Chrome 114+ MV3+

The Side Panel API allows extensions to display their own UI in the side panel, enabling persistent experiences that complement the user's browsing journey.

Some features include:

The following sections demonstrate some common use cases for the Side Panel API. See Extension samples for complete extension examples.

The side panel can be set initially from the "default_path" property in the "side_panel" key of the manifest to display the same side panel on every site. This should point to a relative path within the extension directory.

An extension can use sidepanel.setOptions() to enable a side panel on a specific tab. This example uses chrome.tabs.onUpdated() to listen for any updates made to the tab. It checks if the URL is www.google.com and enables the side panel. Otherwise, it disables it.

When a user temporarily switches to a tab where the side panel is not enabled, the side panel will be hidden. It will automatically show again when the user switches to a tab where it was previously open.

When the user navigates to a site where the side panel is not enabled, the side panel will close, and the extension won't show in the side panel drop-down menu.

For a complete example, see the Tab-specific side panel sample.

Developers can allow users to open the side panel when they click the action toolbar icon with sidePanel.setPanelBehavior(). First, declare the "action" key in the manifest:

Now, add this code to the previous example:

Chrome 116 introduces sidePanel.open(). It allows extensions to open the side panel through an extension user gesture, such as clicking on the action icon. Or a user interaction on an extension page or content script, such as clicking a button. For a complete demo, see the Open Side Panel sample extension.

The following code shows how to open a global side panel on the current window when the user clicks on a context menu. When using sidePanel.open(), you must choose the context in which it should open. Use windowId to open a global side panel. Alternatively, set the tabId to open the side panel only on a specific tab.

Extensions can use si

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My side panel extension",
  ...
  "permissions": [
    "sidePanel"
  ]
}
```

Example 2 (unknown):
```unknown
{
  "name": "My side panel extension",
  ...
  "side_panel": {
    "default_path": "sidepanel.html"
  }
  ...
}
```

Example 3 (unknown):
```unknown
<!DOCTYPE html>
<html>
  <head>
    <title>My Sidepanel</title>
  </head>
  <body>
    <h1>All sites sidepanel extension</h1>
    <p>This side panel is enabled on all sites</p>
  </body>
</html>
```

Example 4 (javascript):
```javascript
const GOOGLE_ORIGIN = 'https://www.google.com';

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url) return;
  const url = new URL(tab.url);
  // Enables the side panel on google.com
  if (url.origin === GOOGLE_ORIGIN) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true
    });
  } else {
    // Disables the side panel on all other sites
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false
    });
  }
});
```

---

## chrome.declarativeNetRequest Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#property-RuleCondition-excludedResponseHeaders

**Contents:**
- chrome.declarativeNetRequest Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Rules and rulesets
  - Dynamic and session-scoped rulesets
  - Static rulesets
- Expedited review
- Enable and disable static rules and rulesets

Description The chrome.declarativeNetRequest API is used to block or modify network requests by specifying declarative rules. This lets extensions modify network requests without intercepting them and viewing their content, thus providing more privacy.

The chrome.declarativeNetRequest API is used to block or modify network requests by specifying declarative rules. This lets extensions modify network requests without intercepting them and viewing their content, thus providing more privacy.

Permissions declarativeNetRequestdeclarativeNetRequestWithHostAccess

The "declarativeNetRequest" and "declarativeNetRequestWithHostAccess" permissions provide the same capabilities. The differences between them is when permissions are requested or granted.

Availability Chrome 84+

In addition to the permissions described previously, certain types of rulesets, static rulesets specifically, require declaring the "declarative_net_request" manifest key, which should be a dictionary with a single key called "rule_resources". This key is an array containing dictionaries of type Ruleset, as shown in the following. (Note that the name 'Ruleset' does not appear in the manifest's JSON since it is merely an array.) Static rulesets are explained later in this document.

To use this API, specify one or more rulesets. A ruleset contains an array of rules. A single rule does one of the following:

There are three types of rulesets, managed in slightly different ways.

Dynamic and session rulesets are managed using JavaScript while an extension is in use.

There is only one each of these ruleset types. An extension can add or remove rules to them dynamically by calling updateDynamicRules() and updateSessionRules(), provided the rule limits aren't exceeded. For information on rule limits, see Rule limits. You can see an example of this under code examples.

Unlike dynamic and session rules, static rules are packaged, installed, and updated when an extension is installed or upgraded. They're stored in rule files in JSON format, which are indicated to the extension using the "declarative_net_request" and "rule_resources" keys as described above, as well as one or more Ruleset dictionaries. A Ruleset dictionary contains a path to the rule file, an ID for the ruleset contained in the file, and whether the ruleset is enabled or disabled. The last two are important when you enable or disable a ruleset programmatically.

To test rule files, load your extension unpacked. Errors and warnings a

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...

  "declarative_net_request" : {
    "rule_resources" : [{
      "id": "ruleset_1",
      "enabled": true,
      "path": "rules_1.json"
    }, {
      "id": "ruleset_2",
      "enabled": false,
      "path": "rules_2.json"
    }]
  },
  "permissions": [
    "declarativeNetRequest",
    "declarativeNetRequestFeedback"
  ],
  "host_permissions": [
    "http://www.blogger.com/*",
    "http://*.google.com/*"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
{
  ...
  "declarative_net_request" : {
    "rule_resources" : [{
      "id": "ruleset_1",
      "enabled": true,
      "path": "rules_1.json"
    },
    ...
    ]
  }
  ...
}
```

Example 3 (unknown):
```unknown
{
  "id" : 1,
  "priority": 1,
  "action" : { "type" : "block" },
  "condition" : {
    "urlFilter" : "abc",
    "initiatorDomains" : ["foo.com"],
    "resourceTypes" : ["script"]
  }
}
```

Example 4 (unknown):
```unknown
rules_1.json: Rule with id 1 specified a more complex regex than allowed
as part of the "regexFilter" key.
```

---

## chrome.fileBrowserHandler Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/fileBrowserHandler

**Contents:**
- chrome.fileBrowserHandler Stay organized with collections Save and categorize content based on your preferences.
- Description
- Concepts and usage
- Permissions
- Availability
  - Implement a file browser handler
- Types
  - FileHandlerExecuteEventDetails
    - Properties
- Events

Important: This API works only on ChromeOS.

Description Use the chrome.fileBrowserHandler API to extend the Chrome OS file browser. For example, you can use this API to enable users to upload files to your website.

Use the chrome.fileBrowserHandler API to extend the Chrome OS file browser. For example, you can use this API to enable users to upload files to your website.

The ChromeOS file browser comes up when the user either presses Alt+Shift+M or connects an external storage device, such as an SD card, USB key, external drive, or digital camera. Besides showing the files on external devices, the file browser can also display files that the user has previously saved to the system.

When the user selects one or more files, the file browser adds buttons representing the valid handlers for those files. For example, in the following screenshot, selecting a file with a ".png" suffix results in an "Save to Gallery" button that the user can click.

Permissions fileBrowserHandler

You must declare the "fileBrowserHandler" permission in the extension manifest.

Availability ChromeOS only Foreground only

You must use the "file_browser_handlers" field to register the extension as a handler of at least one file type. You should also provide a 16 by 16 icon to be displayed on the button. For example:

To use this API, you must implement a function that handles the onExecute event of chrome.fileBrowserHandler. Your function will be called whenever the user clicks the button that represents your file browser handler. In your function, use the File System API to get access to the file contents. Here is an example:

Your event handler is passed two arguments:

Types FileHandlerExecuteEventDetails Event details payload for fileBrowserHandler.onExecute event. Properties entries any[] Array of Entry instances representing files that are targets of this action (selected in ChromeOS file browser). tab_id number optional The ID of the tab that raised this event. Tab IDs are unique within a browser session. Events onExecute chrome.fileBrowserHandler.onExecute.addListener( callback: function,) Fired when file system action is executed from ChromeOS file browser. Parameters callback function The callback parameter looks like: (id: string, details: FileHandlerExecuteEventDetails) => void id string details FileHandlerExecuteEventDetails

Event details payload for fileBrowserHandler.onExecute event.

Array of Entry instances representing files that are targets of this action (sel

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "file_browser_handlers": [
    {
      "id": "upload",
      "default_title": "Save to Gallery", // What the button will display
      "file_filters": [
        "filesystem:*.jpg",  // To match all files, use "filesystem:*.*"
        "filesystem:*.jpeg",
        "filesystem:*.png"
      ]
    }
  ],
  "permissions" : [
    "fileBrowserHandler"
  ],
  "icons": {
    "16": "icon16.png",
    "48": "icon48.png",
    "128": "icon128.png"
  },
  ...
}
```

Example 2 (javascript):
```javascript
chrome.fileBrowserHandler.onExecute.addListener(async (id, details) => {
  if (id !== 'upload') {
    return;  // check if you have multiple file_browser_handlers
  }

  for (const entry of detail.entries) {
    // the FileSystemFileEntry doesn't have a Promise API, wrap in one
    const file = await new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
    const buffer = await file.arrayBuffer();
    // do something with buffer
  }
});
```

---

## chrome.documentScan Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/documentScan

**Contents:**
- chrome.documentScan Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Concepts and usage
  - Simple scanning
  - Complex scanning
    - Discovery
    - Scanner configuration
    - Scanning

Important: This API works only on ChromeOS.

Description Use the chrome.documentScan API to discover and retrieve images from attached document scanners.

Use the chrome.documentScan API to discover and retrieve images from attached document scanners.

The Document Scan API is designed to allow apps and extensions to view the content of paper documents on an attached document scanner.

Permissions documentScan

Availability Chrome 44+ ChromeOS only Availability for API members added later is shown with those members.

This API supports two means of scanning documents. If your use case can work with any scanner and doesn't require control of the configuration, use the scan() method. More complicated use cases require a combination of methods, which are only supported in Chrome 124 and later.

For simple use cases, meaning those that can work with any scanner and don't require control of configuration, call scan(). This method takes a ScanOptions object and returns a Promise that resolves with a ScanResults object. The capabilities of this option are limited to the number of scans and the MIME types that will be accepted by the caller. Scans are returned as URLs for display in an <img> tag for a user interface.

Complex scans are accomplished in three phases as described in this section. This outline does not describe every method argument or every property returned in a response. It is only intended to give you a general guide to writing scanner code.

Call getScannerList(). Available scanners are returned in a Promise that resolves with a GetScannerListResponse.

Select a scanner from the returned array and save the value of its scannerId property.

Use the properties of individual ScannerInfo objects to distinguish among multiple objects for the same scanner. Objects from the same scanner will have the same value for the deviceUuid property. ScannerInfo also contains an imageFormats property containing an array of supported image types.

Call openScanner(), passing in the saved scanner ID. It returns a Promise that resolves with an OpenScannerResponse. The response object contains:

A scannerHandle property, which you'll need to save.

An options property containing scanner-specific properties, which you'll need to set. See Retrieve scanner options for more information.

(Optional) If you need the user to provide values for scanner options, construct a user interface. You will need the scanner options provided by the previous step, and you'll need to retr

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "key1": { scannerOptionInstance }
  "key2": { scannerOptionInstance }
}
```

Example 2 (unknown):
```unknown
{
  "source": {
    "name": "source",
    "type": OptionType.STRING,
...
},
  "resolution": {
    "name": "resolution",
    "type": OptionType.INT,
...
  },
...
}
```

Example 3 (unknown):
```unknown
{
  scannerHandle: "123456",
  result: SUCCESS,
  groups: [
    {
      title: "Standard",
      members: [ "resolution", "mode", "source" ]
    }
  ]
}
```

Example 4 (javascript):
```javascript
async function pageAsBlob(handle) {
  let response = await chrome.documentScan.startScan(
      handle, {format: "image/jpeg"});
  if (response.result != chrome.documentScan.OperationResult.SUCCESS) {
    return null;
  }
  const job = response.job;

  let imgParts = [];
  response = await chrome.documentScan.readScanData(job);
  while (response.result == chrome.documentScan.OperationResult.SUCCESS) {
    if (response.data && response.data.byteLength > 0) {
        imgParts.push(response.data);
    } else {
      // Delay so hardware can make progress.
      await new Promise(r => setTimeout(r
...
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#tabs

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#declarativeNetRequest

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## chrome.extensionTypes Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/extensionTypes#type-RunAt

**Contents:**
- chrome.extensionTypes Stay organized with collections Save and categorize content based on your preferences.
- Description
- Types
  - ColorArray
    - Type
  - CSSOrigin
    - Enum
  - DeleteInjectionDetails
    - Properties
  - DocumentLifecycle

Description The chrome.extensionTypes API contains type declarations for Chrome extensions.

The chrome.extensionTypes API contains type declarations for Chrome extensions.

Types ColorArray Chrome 139+ Type [number, number, number, number] CSSOrigin Chrome 66+ The origin of injected CSS. Enum "author" "user" DeleteInjectionDetails Chrome 87+ Details of the CSS to remove. Either the code or the file property must be set, but both may not be set at the same time. Properties allFrames boolean optional If allFrames is true, implies that the CSS should be removed from all frames of current page. By default, it's false and is only removed from the top frame. If true and frameId is set, then the code is removed from the selected frame and all of its child frames. code string optional CSS code to remove. cssOrigin CSSOrigin optional The origin of the CSS to remove. Defaults to "author". file string optional CSS file to remove. frameId number optional The frame from where the CSS should be removed. Defaults to 0 (the top-level frame). matchAboutBlank boolean optional If matchAboutBlank is true, then the code is also removed from about:blank and about:srcdoc frames if your extension has access to its parent document. By default it is false. DocumentLifecycle Chrome 106+ The document lifecycle of the frame. Enum "prerender" "active" "cached" "pending_deletion" ExecutionWorld Chrome 111+ The JavaScript world for a script to execute within. Can either be an isolated world unique to this extension, the main world of the DOM which is shared with the page's JavaScript, or a user scripts world that is only available for scripts registered with the User Scripts API. Enum "ISOLATED" "MAIN" "USER_SCRIPT" FrameType Chrome 106+ The type of frame. Enum "outermost_frame" "fenced_frame" "sub_frame" ImageDataType Chrome 139+ Pixel data for an image. Must be an ImageData object; for example, from a canvas element. Type ImageData ImageDetails Details about the format, quality, and area of an image. Properties format ImageFormat optional The format of the resulting image. Default is "jpeg". quality number optional When format is "jpeg", controls the quality of the resulting image. This value is ignored for PNG images. As quality is decreased, the resulting image will have more visual artifacts, and the number of bytes needed to store it will decrease. ImageFormat Chrome 44+ The format of an image. Enum "jpeg" "png" InjectDetails Details of the script or CSS to inject. Either the code

*[Content truncated]*

---

## chrome.devtools.inspectedWindow Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow

**Contents:**
- chrome.devtools.inspectedWindow Stay organized with collections Save and categorize content based on your preferences.
- Description
- Manifest
- Execute code in the inspected window
- Examples
- Types
  - Resource
    - Properties
- Properties
  - tabId

Description Use the chrome.devtools.inspectedWindow API to interact with the inspected window: obtain the tab ID for the inspected page, evaluate the code in the context of the inspected window, reload the page, or obtain the list of resources within the page.

Use the chrome.devtools.inspectedWindow API to interact with the inspected window: obtain the tab ID for the inspected page, evaluate the code in the context of the inspected window, reload the page, or obtain the list of resources within the page.

See DevTools APIs summary for general introduction to using Developer Tools APIs.

The tabId property provides the tab identifier that you can use with the chrome.tabs.* API calls. However, please note that chrome.tabs.* API is not exposed to the Developer Tools extension pages due to security considerations—you will need to pass the tab ID to the background page and invoke the chrome.tabs.* API functions from there.

The reload method may be used to reload the inspected page. Additionally, the caller can specify an override for the user agent string, a script that will be injected early upon page load, or an option to force reload of cached resources.

Use the getResources call and the onResourceContent event to obtain the list of resources (documents, stylesheets, scripts, images etc) within the inspected page. The getContent and setContent methods of the Resource class along with the onResourceContentCommitted event may be used to support modification of the resource content, for example, by an external editor.

Manifest The following keys must be declared in the manifest to use this API."devtools_page"

The following keys must be declared in the manifest to use this API.

The eval method provides the ability for extensions to execute JavaScript code in the context of the inspected page. This method is powerful when used in the right context and dangerous when used inappropriately. Use the tabs.executeScript method unless you need the specific functionality that the eval method provides.

Here are the main differences between the eval and tabs.executeScript methods:

Note that a page can include multiple different JavaScript execution contexts. Each frame has its own context, plus an additional context for each extension that has content scripts running in that frame.

By default, the eval method executes in the context of the main frame of the inspected page.

The eval method takes an optional second argument that you can use to specify the context i

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
chrome.devtools.inspectedWindow.eval(
  "jQuery.fn.jquery",
  function(result, isException) {
    if (isException) {
      console.log("the page is not using jQuery");
    } else {
      console.log("The page is using jQuery v" + result);
    }
  }
);
```

---

## chrome.scripting Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/scripting#method-updateContentScripts

**Contents:**
- chrome.scripting Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Concepts and usage
  - Injection targets
  - Injected code
    - Files
    - Runtime functions

Description Use the chrome.scripting API to execute script in different contexts.

Use the chrome.scripting API to execute script in different contexts.

Permissions scripting

Availability Chrome 88+ MV3+

To use the chrome.scripting API, declare the "scripting" permission in the manifest plus the host permissions for the pages to inject scripts into. Use the "host_permissions" key or the "activeTab" permission, which grants temporary host permissions. The following example uses the activeTab permission.

You can use the chrome.scripting API to inject JavaScript and CSS into websites. This is similar to what you can do with content scripts. But by using the chrome.scripting namespace, extensions can make decisions at runtime.

You can use the target parameter to specify a target to inject JavaScript or CSS into.

The only required field is tabId. By default, an injection will run in the main frame of the specified tab.

To run in all frames of the specified tab, you can set the allFrames boolean to true.

You can also inject into specific frames of a tab by specifying individual frame IDs. For more information on frame IDs, see the chrome.webNavigation API.

Extensions can specify the code to be injected either via an external file or a runtime variable.

Files are specified as strings that are paths relative to the extension's root directory. The following code will inject the file script.js into the main frame of the tab.

When injecting JavaScript with scripting.executeScript(), you can specify a function to be executed instead of a file. This function should be a function variable available to the current extension context.

You can work around this by using the args property:

If injecting CSS within a page, you can also specify a string to be used in the css property. This option is only available for scripting.insertCSS(); you can't execute a string using scripting.executeScript().

The results of executing JavaScript are passed to the extension. A single result is included per-frame. The main frame is guaranteed to be the first index in the resulting array; all other frames are in a non-deterministic order.

scripting.insertCSS() does not return any results.

If the resulting value of the script execution is a promise, Chrome will wait for the promise to settle and return the resulting value.

The following snippet contains a function that unregisters all dynamic content scripts the extension has previously registered.

To try the chrome.scripting

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Scripting Extension",
  "manifest_version": 3,
  "permissions": ["scripting", "activeTab"],
  ...
}
```

Example 2 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId()},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected"));
```

Example 3 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), allFrames : true},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected in all frames"));
```

Example 4 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), frameIds : [ frameId1, frameId2 ]},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected on target frames"));
```

---

## Permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/permissions-list#notifications

**Contents:**
- Permissions Stay organized with collections Save and categorize content based on your preferences.

To access most extension APIs and features, you must declare permissions in your extension's manifest. Some permissions trigger warnings that users must allow to continue using the extension.

For more information on how permissions work, see Declare permissions. For best practices for using permissions with warnings, see Permission warning guidelines.

The following is a list of all available permissions and any warnings triggered by specific permissions.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-04-29 UTC.

---

## The Prompt API Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/ai/prompt-api#create_a_session

**Contents:**
- The Prompt API Stay organized with collections Save and categorize content based on your preferences.
  - Review the hardware requirements
- Use the Prompt API
  - Model parameters
  - Create a session
  - Add context with initial prompts
    - Constrain responses with a prefix
  - Add expected input and output
    - Multimodal capabilities
  - Append messages

Thomas Steiner GitHub LinkedIn Mastodon Bluesky Homepage Alexandra Klepper GitHub Bluesky

Published: May 20, 2025, Last updated: September 21, 2025

Published: May 20, 2025, Last updated: September 21, 2025

With the Prompt API, you can send natural language requests to Gemini Nano in the browser.

There are many ways you can use the Prompt API. For example, you could build:

These are just a few possibilities, and we're excited to see what you create.

The following requirements exist for developers and the users who operate features using these APIs in Chrome. Other browsers may have different operating requirements.

The Language Detector and Translator APIs work in Chrome on desktop. These APIs do not work on mobile devices. The Prompt API, Summarizer API, Writer API, Rewriter API, and Proofreader API work in Chrome when the following conditions are met:

Gemini Nano's exact size may vary as the browser updates the model. To determine the current size, visit chrome://on-device-internals.

The Prompt API uses the Gemini Nano model in Chrome. While the API is built into Chrome, the model is downloaded separately the first time an origin uses the API. Before you use this API, acknowledge Google's Generative AI Prohibited Uses Policy.

To determine if the model is ready to use, call LanguageModel.availability().

To trigger the download and instantiate the language model, check for user activation. Then, call the create() function.

If the response to availability() was downloading, listen for download progress and inform the user, as the download may take time.

The params() function informs you of the language model's parameters. The object has the following fields:

Once the Prompt API can run, you create a session with the create() function.

Each session can be customized with topK and temperature using an optional options object. The default values for these parameters are returned from LanguageModel.params().

The create() function's optional options object also takes a signal field, which lets you pass an AbortSignal to destroy the session.

With initial prompts, you can provide the language model with context about previous interactions, for example, to allow the user to resume a stored session after a browser restart.

You can add an "assistant" role, in addition to previous roles, to elaborate on the model's previous responses. For example:

In some cases, instead of requesting a new response, you may want to prefill part of the "assistant"-rol

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
const availability = await LanguageModel.availability();
```

Example 2 (javascript):
```javascript
const session = await LanguageModel.create({
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloaded ${e.loaded * 100}%`);
    });
  },
});
```

Example 3 (unknown):
```unknown
await LanguageModel.params();
// {defaultTopK: 3, maxTopK: 128, defaultTemperature: 1, maxTemperature: 2}
```

Example 4 (javascript):
```javascript
const params = await LanguageModel.params();
// Initializing a new session must either specify both `topK` and
// `temperature` or neither of them.
const slightlyHighTemperatureSession = await LanguageModel.create({
  temperature: Math.max(params.defaultTemperature * 1.2, 2.0),
  topK: params.defaultTopK,
});
```

---

## chrome.bookmarks Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/bookmarks

**Contents:**
- chrome.bookmarks Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Concepts and usage
  - Objects and properties
  - Examples
- Types
  - BookmarkTreeNode
    - Properties
  - BookmarkTreeNodeUnmodifiable

Description Use the chrome.bookmarks API to create, organize, and otherwise manipulate bookmarks. Also see Override Pages, which you can use to create a custom Bookmark Manager page.

Use the chrome.bookmarks API to create, organize, and otherwise manipulate bookmarks. Also see Override Pages, which you can use to create a custom Bookmark Manager page.

Permissions bookmarks

You must declare the "bookmarks" permission in the extension manifest to use the bookmarks API. For example:

Bookmarks are organized in a tree, where each node in the tree is either a bookmark or a folder (sometimes called a group). Each node in the tree is represented by a bookmarks.BookmarkTreeNode object.

BookmarkTreeNode properties are used throughout the chrome.bookmarks API. For example, when you call bookmarks.create, you pass in the new node's parent (parentId), and, optionally, the node's index, title, and url properties. See bookmarks.BookmarkTreeNode for information about the properties a node can have.

The following code creates a folder with the title "Extension bookmarks". The first argument to create() specifies properties for the new folder. The second argument defines a function to be executed after the folder is created.

The next snippet creates a bookmark pointing to the developer documentation for extensions. Since nothing bad will happen if creating the bookmark fails, this code doesn't bother to define a callback function.

To try this API, install the Bookmarks API example from the chrome-extension-samples repository.

Types BookmarkTreeNode A node (either a bookmark or a folder) in the bookmark tree. Child nodes are ordered within their parent folder. Properties children BookmarkTreeNode[] optional An ordered list of children of this node. dateAdded number optional When this node was created, in milliseconds since the epoch (new Date(dateAdded)). dateGroupModified number optional When the contents of this folder last changed, in milliseconds since the epoch. dateLastUsed number optional Chrome 114+ When this node was last opened, in milliseconds since the epoch. Not set for folders. folderType FolderType optional Chrome 134+ If present, this is a folder that is added by the browser and that cannot be modified by the user or the extension. Child nodes may be modified, if this node does not have the unmodifiable property set. Omitted if the node can be modified by the user and the extension (default). There may be zero, one or multiple nodes of each folder ty

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "bookmarks"
  ],
  ...
}
```

Example 2 (unknown):
```unknown
chrome.bookmarks.create(
  {'parentId': bookmarkBar.id, 'title': 'Extension bookmarks'},
  function(newFolder) {
    console.log("added folder: " + newFolder.title);
  },
);
```

Example 3 (unknown):
```unknown
chrome.bookmarks.create({
  'parentId': extensionsFolderId,
  'title': 'Extensions doc',
  'url': 'https://developer.chrome.com/docs/extensions',
});
```

---

## chrome.runtime Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getURL

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

## chrome.scripting Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/scripting#method-getRegisteredContentScripts

**Contents:**
- chrome.scripting Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Availability
- Manifest
- Concepts and usage
  - Injection targets
  - Injected code
    - Files
    - Runtime functions

Description Use the chrome.scripting API to execute script in different contexts.

Use the chrome.scripting API to execute script in different contexts.

Permissions scripting

Availability Chrome 88+ MV3+

To use the chrome.scripting API, declare the "scripting" permission in the manifest plus the host permissions for the pages to inject scripts into. Use the "host_permissions" key or the "activeTab" permission, which grants temporary host permissions. The following example uses the activeTab permission.

You can use the chrome.scripting API to inject JavaScript and CSS into websites. This is similar to what you can do with content scripts. But by using the chrome.scripting namespace, extensions can make decisions at runtime.

You can use the target parameter to specify a target to inject JavaScript or CSS into.

The only required field is tabId. By default, an injection will run in the main frame of the specified tab.

To run in all frames of the specified tab, you can set the allFrames boolean to true.

You can also inject into specific frames of a tab by specifying individual frame IDs. For more information on frame IDs, see the chrome.webNavigation API.

Extensions can specify the code to be injected either via an external file or a runtime variable.

Files are specified as strings that are paths relative to the extension's root directory. The following code will inject the file script.js into the main frame of the tab.

When injecting JavaScript with scripting.executeScript(), you can specify a function to be executed instead of a file. This function should be a function variable available to the current extension context.

You can work around this by using the args property:

If injecting CSS within a page, you can also specify a string to be used in the css property. This option is only available for scripting.insertCSS(); you can't execute a string using scripting.executeScript().

The results of executing JavaScript are passed to the extension. A single result is included per-frame. The main frame is guaranteed to be the first index in the resulting array; all other frames are in a non-deterministic order.

scripting.insertCSS() does not return any results.

If the resulting value of the script execution is a promise, Chrome will wait for the promise to settle and return the resulting value.

The following snippet contains a function that unregisters all dynamic content scripts the extension has previously registered.

To try the chrome.scripting

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Scripting Extension",
  "manifest_version": 3,
  "permissions": ["scripting", "activeTab"],
  ...
}
```

Example 2 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId()},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected"));
```

Example 3 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), allFrames : true},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected in all frames"));
```

Example 4 (javascript):
```javascript
function getTabId() { ... }

chrome.scripting
    .executeScript({
      target : {tabId : getTabId(), frameIds : [ frameId1, frameId2 ]},
      files : [ "script.js" ],
    })
    .then(() => console.log("script injected on target frames"));
```

---

## The Chrome Extension update lifecycle Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle

**Contents:**
- The Chrome Extension update lifecycle Stay organized with collections Save and categorize content based on your preferences.
- The standard update cycle
- Monitor extension update distribution
- Update extensions manually
- Check for updates from an Extension
  - Check for updates on demand
  - Listen for available updates
- Controlling updates via enterprise policy
  - Force installation
  - Pin extension version

This guide details the complete extension update flow, covering the standard update process, manual overrides, developer APIs, and the significant impact of enterprise policies.

Chrome is designed to automatically update installed extensions to their latest versions, ensuring users have access to new features and security fixes. By default, Chrome checks for extension updates on startup and every few hours.

A critical aspect of the update process is that an update is only installed when the extension is considered idle. For an extension to be idle, its components must not be in active use. In the context of Manifest V3, this primarily means that the extension's service worker is not running. The service worker is designed to be event-driven and terminates after a period of inactivity. Additionally, any open extension pages, such as side panel, popup, or an options page, prevents the extension from being considered idle. An active content script does not affect whether an extension is considered idle or not.

This idle requirement can cause delays in updates for frequently active extensions. If an extension's service worker is constantly being triggered by events, it may never reach an idle state, and the update will be deferred until the browser is restarted.

To find out how many of your users are on the latest version of your extension, use the Chrome WebStore analytics dashboard. Go to the Chrome WebStore developer dashboard and select one of your published extensions. In the side navigation bar go to: Analytics -> Users and scroll down to the Daily users by item chart. Here you can see how many users are already on your latest version.

If users want to receive the latest updates immediately, Chrome provides a manual update mechanism. This is also a useful tool when testing updates.

Individual users can force an update for all their installed extensions by following these steps:

This action prompts Chrome to immediately fetch the latest versions of all installed extensions from the Chrome Web Store.

The chrome.runtime API provides tools for extensions to interact with the update mechanism.

The chrome.runtime.requestUpdateCheck() function lets an extension initiate an update check programmatically. This is particularly useful for extensions that have a critical dependency on a backend service and need to ensure they are running the latest compatible version.

When this function is called, Chrome queries the Chrome Web Store for a new version and d

*[Content truncated]*

---

## chrome.omnibox Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/omnibox

**Contents:**
- chrome.omnibox Stay organized with collections Save and categorize content based on your preferences.
- Description
- Manifest
- Examples
- Types
  - DefaultSuggestResult
    - Properties
  - DescriptionStyleType
    - Enum
  - OnInputEnteredDisposition

Description The omnibox API allows you to register a keyword with Google Chrome's address bar, which is also known as the omnibox.

The omnibox API allows you to register a keyword with Google Chrome's address bar, which is also known as the omnibox.

When the user enters your extension's keyword, the user starts interacting solely with your extension. Each keystroke is sent to your extension, and you can provide suggestions in response.

The suggestions can be richly formatted in a variety of ways. When the user accepts a suggestion, your extension is notified and can take action.

Manifest The following keys must be declared in the manifest to use this API."omnibox"

The following keys must be declared in the manifest to use this API.

You must include an "omnibox.keyword" field in the manifest to use the omnibox API. You should also specify a 16 by 16-pixel icon, which will be displayed in the address bar when suggesting that users enter keyword mode.

To try this API, install the omnibox API example from the chrome-extension-samples repository.

Types DefaultSuggestResult A suggest result. Properties description string The text that is displayed in the URL dropdown. Can contain XML-style markup for styling. The supported tags are 'url' (for a literal URL), 'match' (for highlighting text that matched what the user's query), and 'dim' (for dim helper text). The styles can be nested, eg. dimmed match. DescriptionStyleType Chrome 44+ The style type. Enum "url" "match" "dim" OnInputEnteredDisposition Chrome 44+ The window disposition for the omnibox query. This is the recommended context to display results. For example, if the omnibox command is to navigate to a certain URL, a disposition of 'newForegroundTab' means the navigation should take place in a new selected tab. Enum "currentTab" "newForegroundTab" "newBackgroundTab" SuggestResult A suggest result. Properties content string The text that is put into the URL bar, and that is sent to the extension when the user chooses this entry. deletable boolean optional Chrome 63+ Whether the suggest result can be deleted by the user. description string The text that is displayed in the URL dropdown. Can contain XML-style markup for styling. The supported tags are 'url' (for a literal URL), 'match' (for highlighting text that matched what the user's query), and 'dim' (for dim helper text). The styles can be nested, eg. dimmed match. You must escape the five predefined entities to display them as text: stackoverfl

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Aaron's omnibox extension",
  "version": "1.0",
  "omnibox": { "keyword" : "aaron" },
  "icons": {
    "16": "16-full-color.png"
  },
  "background": {
    "persistent": false,
    "scripts": ["background.js"]
  }
}
```

---

## chrome.downloads Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/downloads

**Contents:**
- chrome.downloads Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Examples
- Types
  - BooleanDelta
    - Properties
  - DangerType
    - Enum
  - DoubleDelta

Description Use the chrome.downloads API to programmatically initiate, monitor, manipulate, and search for downloads.

Use the chrome.downloads API to programmatically initiate, monitor, manipulate, and search for downloads.

Permissions downloads

You must declare the "downloads" permission in the extension manifest to use this API.

You can find simple examples of using the chrome.downloads API in the examples/api/downloads directory. For other examples and for help in viewing the source code, see Samples.

Types BooleanDelta Properties current boolean optional previous boolean optional DangerType file The download's filename is suspicious. url The download's URL is known to be malicious. content The downloaded file is known to be malicious. uncommon The download's URL is not commonly downloaded and could be dangerous. host The download came from a host known to distribute malicious binaries and is likely dangerous. unwanted The download is potentially unwanted or unsafe. E.g. it could make changes to browser or computer settings. safe The download presents no known danger to the user's computer. accepted The user has accepted the dangerous download. Enum "file" "url" "content" "uncommon" "host" "unwanted" "safe" "accepted" "allowlistedByPolicy" "asyncScanning" "asyncLocalPasswordScanning" "passwordProtected" "blockedTooLarge" "sensitiveContentWarning" "sensitiveContentBlock" "deepScannedFailed" "deepScannedSafe" "deepScannedOpenedDangerous" "promptForScanning" "promptForLocalPasswordScanning" "accountCompromise" "blockedScanFailed" DoubleDelta Properties current number optional previous number optional DownloadDelta Properties canResume BooleanDelta optional The change in canResume, if any. danger StringDelta optional The change in danger, if any. endTime StringDelta optional The change in endTime, if any. error StringDelta optional The change in error, if any. exists BooleanDelta optional The change in exists, if any. fileSize DoubleDelta optional The change in fileSize, if any. filename StringDelta optional The change in filename, if any. finalUrl StringDelta optional Chrome 54+ The change in finalUrl, if any. id number The id of the DownloadItem that changed. mime StringDelta optional The change in mime, if any. paused BooleanDelta optional The change in paused, if any. startTime StringDelta optional The change in startTime, if any. state StringDelta optional The change in state, if any. totalBytes DoubleDelta optional The change in totalBytes, if an

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "permissions": [
    "downloads"
  ],
}
```

---

## Use the Notifications API Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/how-to/ui/notifications

**Contents:**
- Use the Notifications API Stay organized with collections Save and categorize content based on your preferences.
- How they look
- How they behave
- How to develop them
  - Create a basic notification
  - Use an image
  - Create a list notification
- Listen for and respond to events

The chrome.notifications API lets you create notifications using templates and show these notifications to users in the user's system tray:

Rich notifications come in four different flavors: basic, image, list, and progress. All notifications include a title, message, small icon displayed to the left of the notification message, and a contextMessage field, which is displayed as a third text field in a lighter color font.

A basic notification:

List notifications display any number of list items:

Image notifications include an image preview:

Progress notifications show a progress bar:

On ChromeOS, notifications show up in a user's system tray, and stay in the system tray until the user dismisses them. The system tray keeps a count of all new notifications. Once a users sees the notifications in the system tray, the count is reset to zero.

Notifications can be assigned a priority between -2 to 2. Priorities less than 0 are shown in the ChromeOS notification center, and produce an error on other platforms. The default priority is 0. Priorities greater than 0 are shown for increasing duration and more high priority notifications can be displayed in the system tray.

The priority setting does not affect the order of notifications on macOS.

In addition to displaying information, all notification types can include up to two action items. When users click an action item, your extension can respond with the appropriate action. For example, when the user clicks Reply, the email app opens and the user can complete the reply:

To use this API, call the notifications.create() method, passing in the notification details using the options parameter:

The notifications.NotificationOptions must include a notifications.TemplateType, which defines available notification details and how those details are displayed.

All template types (basic, image, list and progress) must include a notification title and message, as well as an iconUrl, which is a link to a small icon that is displayed to the left of the notification message.

Here's an example of a basic template:

The image template type also includes an imageUrl, which is a link to an image that is previewed within the notification. Note that images are not shown to users on macOS.

The list template displays items in a list format. Note that only the first item is displayed to users on macOS.

All notifications can include event listeners and event handlers that respond to user actions (see chrome.events). For exam

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
await chrome.notifications.create(id, options);
```

Example 2 (unknown):
```unknown
var opt = {
  type: "basic",
  title: "Primary Title",
  message: "Primary message to display",
  iconUrl: "url_to_small_icon"
}
```

Example 3 (unknown):
```unknown
var opt = {
  type: "image",
  title: "Primary Title",
  message: "Primary message to display",
  iconUrl: "url_to_small_icon",
  imageUrl: "url_to_preview_image"
}
```

Example 4 (unknown):
```unknown
var opt = {
  type: "list",
  title: "Primary Title",
  message: "Primary message to display",
  iconUrl: "url_to_small_icon",
  items: [{ title: "Item1", message: "This is item 1."},
          { title: "Item2", message: "This is item 2."},
          { title: "Item3", message: "This is item 3."}]
}```

### Create progress notification {: #progress }

The `progress` template displays a progress bar where current progress ranges from 0 to 100. On macOS the progress bar displays as a percentage value in the notification title instead of in the progress bar.

```js
var opt = {
  type: "progress",

...
```

---

## chrome.permissions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/permissions

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

## chrome.i18n Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/api/i18n#overview-predefined

**Contents:**
- chrome.i18n Stay organized with collections Save and categorize content based on your preferences.
- Description
- Manifest
- Concepts and usage
  - Support multiple languages
  - Predefined messages
  - Locales
  - Search for messages
  - Set your browser's locale
    - Windows

Description Use the chrome.i18n infrastructure to implement internationalization across your whole app or extension.

Use the chrome.i18n infrastructure to implement internationalization across your whole app or extension.

If an extension has a /_locales directory, the manifest must define "default_locale".

You need to put all of its user-visible strings into a file named messages.json. Each time you add a new locale, you add a messages file under a directory named /_locales/_localeCode_, where localeCode is a code such as en for English.

Here's the file hierarchy for an internationalized extension that supports English (en), Spanish (es), and Korean (ko):

Say you have an extension with the files shown in the following figure:

To internationalize this extension, you name each user-visible string and put it into a messages file. The extension's manifest, CSS files, and JavaScript code use each string's name to get its localized version.

Here's what the extension looks like when it's internationalized (note that it still has only English strings):

Some notes about internationalizing:

In manifest.json and CSS files, refer to a string named messagename like this:

In your extension or app's JavaScript code, refer to a string named messagename like this:

In each call to getMessage(), you can supply up to 9 strings to be included in the message. See Examples: getMessage for details.

Some messages, such as @@bidi_dir and @@ui_locale, are provided by the internationalization system. See the Predefined messages section for a full list of predefined message names.

In messages.json, each user-visible string has a name, a "message" item, and an optional "description" item. The name is a key such as "extName" or "search_string" that identifies the string. The "message" specifies the value of the string in this locale. The optional "description" provides help to translators, who might not be able to see how the string is used in your extension. For example:

For more information, see Formats: Locale-Specific Messages.

Once an extension is internationalized, translating it is straightforward. You copy messages.json, translate it, and put the copy into a new directory under /_locales. For example, to support Spanish, just put a translated copy of messages.json under /_locales/es. The following figure shows the previous extension with a new Spanish translation.

The internationalization system provides a few predefined messages to help you localize. These inclu

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
__MSG_messagename__
```

Example 2 (unknown):
```unknown
chrome.i18n.getMessage("messagename")
```

Example 3 (unknown):
```unknown
{
  "search_string": {
    "message": "hello%20world",
    "description": "The string we search for. Put %20 between words that go together."
  },
  ...
}
```

Example 4 (unknown):
```unknown
body {
  background-image:url('chrome-extension://__MSG_@@extension_id__/background.png');
}
```

---

## The Prompt API Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/ai/prompt-api#session_management

**Contents:**
- The Prompt API Stay organized with collections Save and categorize content based on your preferences.
  - Review the hardware requirements
- Use the Prompt API
  - Model parameters
  - Create a session
  - Add context with initial prompts
    - Constrain responses with a prefix
  - Add expected input and output
    - Multimodal capabilities
  - Append messages

Thomas Steiner GitHub LinkedIn Mastodon Bluesky Homepage Alexandra Klepper GitHub Bluesky

Published: May 20, 2025, Last updated: September 21, 2025

Published: May 20, 2025, Last updated: September 21, 2025

With the Prompt API, you can send natural language requests to Gemini Nano in the browser.

There are many ways you can use the Prompt API. For example, you could build:

These are just a few possibilities, and we're excited to see what you create.

The following requirements exist for developers and the users who operate features using these APIs in Chrome. Other browsers may have different operating requirements.

The Language Detector and Translator APIs work in Chrome on desktop. These APIs do not work on mobile devices. The Prompt API, Summarizer API, Writer API, Rewriter API, and Proofreader API work in Chrome when the following conditions are met:

Gemini Nano's exact size may vary as the browser updates the model. To determine the current size, visit chrome://on-device-internals.

The Prompt API uses the Gemini Nano model in Chrome. While the API is built into Chrome, the model is downloaded separately the first time an origin uses the API. Before you use this API, acknowledge Google's Generative AI Prohibited Uses Policy.

To determine if the model is ready to use, call LanguageModel.availability().

To trigger the download and instantiate the language model, check for user activation. Then, call the create() function.

If the response to availability() was downloading, listen for download progress and inform the user, as the download may take time.

The params() function informs you of the language model's parameters. The object has the following fields:

Once the Prompt API can run, you create a session with the create() function.

Each session can be customized with topK and temperature using an optional options object. The default values for these parameters are returned from LanguageModel.params().

The create() function's optional options object also takes a signal field, which lets you pass an AbortSignal to destroy the session.

With initial prompts, you can provide the language model with context about previous interactions, for example, to allow the user to resume a stored session after a browser restart.

You can add an "assistant" role, in addition to previous roles, to elaborate on the model's previous responses. For example:

In some cases, instead of requesting a new response, you may want to prefill part of the "assistant"-rol

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
const availability = await LanguageModel.availability();
```

Example 2 (javascript):
```javascript
const session = await LanguageModel.create({
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloaded ${e.loaded * 100}%`);
    });
  },
});
```

Example 3 (unknown):
```unknown
await LanguageModel.params();
// {defaultTopK: 3, maxTopK: 128, defaultTemperature: 1, maxTemperature: 2}
```

Example 4 (javascript):
```javascript
const params = await LanguageModel.params();
// Initializing a new session must either specify both `topK` and
// `temperature` or neither of them.
const slightlyHighTemperatureSession = await LanguageModel.create({
  temperature: Math.max(params.defaultTemperature * 1.2, 2.0),
  topK: params.defaultTopK,
});
```

---
