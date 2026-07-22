# Chrome-Extension - Other

**Pages:** 28

---

## Use Web Push Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/how-to/integrate/web-push

**Contents:**
- Use Web Push Stay organized with collections Save and categorize content based on your preferences.
  - Get permission to use the Push API
  - Push providers and Push services
  - Self hosting a Push provider
  - Silent Push

In extensions you can use any Push provider to send push notifications and messages. A push from the Push API will be processed by your service worker as soon as it is received. If the service worker has been suspended, a Push will wake it back up. The process to use it in extensions is exactly the same as what you would use it on the open web.

When you register a Push server on a normal website, the user is shown a permission prompt to grant or deny it. With extensions that prompt won't be shown. In order to use the Push API in your extension, you need to set the notifications permission in your manifest.json

If you are missing this permission, then any interaction with registration.pushManager will result in an immediate error, the same result as if the user has denied the permission. Additionally, keep in mind that the notifications permission will cause a permission warning to be displayed on install. Chrome will also disable the extension for any existing installs until the user approves the new permission request. You can learn more about how to handle this in the permission warning guide.

Once you have added the permission to your manifest.json, you will need to configure the connection between your backend and the extension. This connection can be thought of in two parts - the Push provider, and the Push service. A provider is the SDK being used by you to send the message to the Push service. There are many different options, and any Push provider can work for the Push API (though they may not offer an SDK that makes it simple to integrate). You will need to experiment with your provider's SDK to see what is possible. A Push service is what the end user's device is registered with, so it can be alerted to any push message sent by a Push provider. This is something that you have no control over, as it is hardcoded into individual browsers. For Chrome, Firebase Cloud Messaging is the Push service. Any messages being pushed to a Chrome user will routed through it.

Any Push provider can work, however not all providers offer an SDK that works in service workers. You will need to consult your provider if you have issues getting it running. You don't need to use a public provider, however. Using libraries like web-push, you can host your own backend.

You can test out this library using web-push-codelab.glitch.me. Specifically, you will need to copy the Push server's VAPID public key in order to generate the Push subscription in the browser. This publ

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
  {
    "manifest_version": 3,
    ...
    "permissions": ["notifications"]
```

Example 2 (javascript):
```javascript
function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
```

Example 3 (javascript):
```javascript
const SERVER_PUBLIC_KEY = '_INSERT_VALUE_HERE_';
const applicationServerKey = urlB64ToUint8Array(SERVER_PUBLIC_KEY);

async function subscribe() {
  try {
    let subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });

    console.log(`Subscribed: ${JSON.stringify(subscription,0,2)}`);

    return subscription
  } catch (error) {
    console.error('Subscribe error: ', error);
  }
}

const subscription = await subscribe();
```

Example 4 (unknown):
```unknown
self.addEventListener('push', function (event) {
  console.log(`Push had this data/text: "${event.data.text()}"`);
});
```

---

## OAuth 2.0: authenticate users with Google Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/how-to/integrate/oauth

**Contents:**
- OAuth 2.0: authenticate users with Google Stay organized with collections Save and categorize content based on your preferences.
- Get started
  - manifest.json
  - service-worker.js
  - index.html
- Keep a consistent extension ID
  - Upload extension to the developer dashboard
  - Compare IDs
- Create an OAuth client ID
- Register OAuth in the manifest

OAuth2 is the industry-standard protocol for authorization. It provides a mechanism for users to grant web and desktop applications access to private information without sharing their username, password, and other private credentials.

This tutorial builds an extension that accesses a user's Google contacts using the Google People API and the Chrome Identity API. Because extensions don't load over HTTPS, can't perform redirects or set cookies, they rely on the Chrome Identity API to use OAuth2.

Begin by creating a directory and the following starter files.

Add the manifest by creating a file called manifest.json and include the following code.

Add the extension service worker by creating a file called service-worker.js and include the following code.

Add an HTML file called index.html and include the following code.

Preserving a single ID is essential during development. To keep a consistent ID, follow these steps:

Package the extension directory into a .zip file and upload it to the Chrome Developer Dashboard without publishing it:

When the dialog is open, follow these steps:

Add the code to the manifest.json under the "key" field. This way the extension will use the same ID.

Open the Extensions Management page at chrome://extensions, ensure Developer mode is enabled, and upload the unpackaged extension directory. Compare the extension ID on the extensions management page to the Item ID in the Developer Dashboard. They should match.

Any application that uses OAuth 2.0 to access Google APIs must have authorization credentials that identify the application to Google's OAuth 2.0 server. The following steps explain how to create credentials for your project. Your applications can then use the credentials to access APIs that you have enabled for that project.

Start by navigating to the Google API console to create a new project if you don't already have one. Follow these instructions to create an OAuth Client and obtain a Client ID.

Include the "oauth2" field in the extension manifest. Place the generated OAuth client ID under "client_id". Include an empty string in "scopes" for now.

Register the identity permission in the manifest.

Create a file to manage the OAuth flow called oauth.js and include the following code.

Place a script tag for oauth.js in the head of index.html.

Reload the extension and click the browser icon to open index.html. Open the console and click the "FriendBlock Contacts" button. An OAuth token will appear in the console

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "OAuth Tutorial FriendBlock",
  "version": "1.0",
  "description": "Uses OAuth to connect to Google's People API and display contacts photos.",
  "manifest_version": 3,
  "action": {
    "default_title": "FriendBlock, friends face's in a block."
  },
  "background": {
    "service_worker": "service-worker.js"
  }
}
```

Example 2 (unknown):
```unknown
chrome.action.onClicked.addListener(function() {
  chrome.tabs.create({url: 'index.html'});
});
```

Example 3 (unknown):
```unknown
<html>
  <head>
    <title>FriendBlock</title>
    <style>
      button {
        padding: 10px;
        background-color: #3C79F8;
        display: inline-block;
      }
    </style>
  </head>
  <body>
    <button>FriendBlock Contacts</button>
    <div id="friendDiv"></div>
  </body>
</html>
```

Example 4 (unknown):
```unknown
{ // manifest.json
  "manifest_version": 3,
...
  "key": "ThisKeyIsGoingToBeVeryLong/go8GGC2u3UD9WI3MkmBgyiDPP2OreImEQhPvwpliioUMJmERZK3zPAx72z8MDvGp7Fx7ZlzuZpL4yyp4zXBI+MUhFGoqEh32oYnm4qkS4JpjWva5Ktn4YpAWxd4pSCVs8I4MZms20+yx5OlnlmWQEwQiiIwPPwG1e1jRw0Ak5duPpE3uysVGZXkGhC5FyOFM+oVXwc1kMqrrKnQiMJ3lgh59LjkX4z1cDNX3MomyUMJ+I+DaWC2VdHggB74BNANSd+zkPQeNKg3o7FetlDJya1bk8ofdNBARxHFMBtMXu/ONfCT3Q2kCY9gZDRktmNRiHG/1cXhkIcN1RWrbsCkwIDAQAB",
}
```

---

## Distribute your extension Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/hosting/

**Contents:**
- Distribute your extension Stay organized with collections Save and categorize content based on your preferences.

If you're just building extensions for yourself, you can load an extension unpacked. Unpacked extensions should only be used to load trusted code during the development process.

If you're not building an extension for your personal use, you'll eventually need to distribute it. There are only two officially supported distribution mechanisms. In both cases, Chrome periodically checks extension hosts for new versions of installed extensions and automatically updates them without user intervention.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-12-12 UTC.

---

## What are themes? Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/ui/themes

**Contents:**
- What are themes? Stay organized with collections Save and categorize content based on your preferences.
- Manifest
  - colors
  - images
  - properties
  - tints

A theme is a special kind of extension that changes the way the browser looks. Themes are packaged like regular extensions, but they don't contain JavaScript or HTML code.

Themes are uploaded to the Chrome Web Store using the same procedure as an extension. During upload, you'll be asked to select a category. You'll find a list of theme categories in Chrome Web Store documentation under Best practices.

You can find and try a bunch of themes at the Chrome Web Store.

Here is an example manifest.json file for a theme:

Colors are in RGB format. To find the strings you can use within the "colors" field, see kOverwritableColorTable.

Image resources use paths relative to the root of the extension. You can override any of the images that are specified by the strings in kPersistingImages. All images must be stored in PNG format or they will not render properly.

This field lets you specify properties such as background alignment, background repeat, and an alternate logo. To see the properties and the values they can have, see kDisplayProperties.

You can specify tints to be applied to parts of the UI such as buttons, the frame, and the background tab. Google Chrome supports tints, not images, because images don't work across platforms and are brittle in the case of adding new buttons. To find the strings you can use within the "tints" field, see kTintTable.

Tints are in Hue-Saturation-Lightness (HSL) format, using floating-point numbers in the range 0 - 1.0:

You can alternatively use -1.0 for any of the HSL values to specify no change.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2012-09-18 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "manifest_version": 3,
  "version": "2.6",
  "name": "camo theme",
  "theme": {
    "images" : {
      "theme_frame" : "images/theme_frame_camo.png",
      "theme_frame_overlay" : "images/theme_frame_stripe.png",
      "theme_toolbar" : "images/theme_toolbar_camo.png",
      "theme_ntp_background" : "images/theme_ntp_background_norepeat.png",
      "theme_ntp_attribution" : "images/attribution.png"
    },
    "colors" : {
      "frame" : [71, 105, 91],
      "toolbar" : [207, 221, 192],
      "ntp_text" : [20, 40, 0],
      "ntp_link" : [36, 70, 0],
      "ntp_section" : [207, 221, 192],
 
...
```

---

## chrome.identity Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/reference/identity

**Contents:**
- chrome.identity Stay organized with collections Save and categorize content based on your preferences.
- Description
- Permissions
- Types
  - AccountInfo
    - Properties
  - AccountStatus
    - Enum
  - GetAuthTokenResult
    - Properties

Description Use the chrome.identity API to get OAuth2 access tokens.

Use the chrome.identity API to get OAuth2 access tokens.

Types AccountInfo Properties id string A unique identifier for the account. This ID will not change for the lifetime of the account. AccountStatus Chrome 84+ Enum "SYNC" Specifies that Sync is enabled for the primary account."ANY" Specifies the existence of a primary account, if any. GetAuthTokenResult Chrome 105+ Properties grantedScopes string[] optional A list of OAuth2 scopes granted to the extension. token string optional The specific token associated with the request. InvalidTokenDetails Properties token string The specific token that should be removed from the cache. ProfileDetails Chrome 84+ Properties accountStatus AccountStatus optional A status of the primary account signed into a profile whose ProfileUserInfo should be returned. Defaults to SYNC account status. ProfileUserInfo Properties email string An email address for the user account signed into the current profile. Empty if the user is not signed in or the identity.email manifest permission is not specified. id string A unique identifier for the account. This ID will not change for the lifetime of the account. Empty if the user is not signed in or (in M41+) the identity.email manifest permission is not specified. TokenDetails Properties account AccountInfo optional The account ID whose token should be returned. If not specified, the function will use an account from the Chrome profile: the Sync account if there is one, or otherwise the first Google web account. enableGranularPermissions boolean optional Chrome 87+ The enableGranularPermissions flag allows extensions to opt-in early to the granular permissions consent screen, in which requested permissions are granted or denied individually. interactive boolean optional Fetching a token may require the user to sign-in to Chrome, or approve the application's requested scopes. If the interactive flag is true, getAuthToken will prompt the user as necessary. When the flag is false or omitted, getAuthToken will return failure any time a prompt would be required. scopes string[] optional A list of OAuth2 scopes to request. When the scopes field is present, it overrides the list of scopes specified in manifest.json. WebAuthFlowDetails Properties abortOnLoadForNonInteractive boolean optional Chrome 113+ Whether to terminate launchWebAuthFlow for non-interactive requests after the page loads. This parameter does not affect 

*[Content truncated]*

---

## Test service worker termination with Puppeteer Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/how-to/test/test-serviceworker-termination-with-puppeteer

**Contents:**
- Test service worker termination with Puppeteer Stay organized with collections Save and categorize content based on your preferences.
- Before you start
- Step 1: Start your Node.js project
- Step 2: Install dependencies
- Step 3: Write a basic test
- Step 4: Terminate the service worker
- Step 5: Run your test
- Step 6: Fix the service worker
- Step 7: Run your test again
- Next steps

This guide explains how to build more robust extensions by testing service worker termination using Puppeteer. Being prepared to handle termination at any time is important because this can happen without warning resulting in any non-persistent state in the service worker being lost. Consequently, extensions must save important state and be able to handle requests as soon as they are started up again when there is an event to handle.

Clone or download the chrome-extensions-samples repository. We'll use the test extension in /functional-samples/tutorial.terminate-sw/test-extension which sends a message to the service worker each time a button is clicked and adds text to the page if a response is received.

You'll also need to install Node.JS which is the runtime that Puppeteer is built on.

Create the following files in a new directory. Together they create a new Node.js project and provide the basic structure of a Puppeteer test suite using Jest as a test runner. See Test Chrome Extensions with Puppeteer to learn about this setup in more detail.

Notice that our test loads the test-extension from the samples repository. The handler for chrome.runtime.onMessage relies on state set in the handler for the chrome.runtime.onInstalled event. As a result, the contents of data will be lost when the service worker is terminated and responding to any future messages will fail. We will fix this after writing our test.

service-worker-broken.js:

Run npm install to install the required dependencies.

Add the following test to the bottom of index.test.js. This opens the test page from our test extension, clicks the button element and waits for a response from the service worker.

You can run your test with npm start and should see that it completes successfully.

Add the following helper function which terminates your service worker:

Finally, update your test with the following code. Now terminate the service worker and click the button again to check that you received a response.

Run npm start. Your test should fail which indicates that the service worker did not respond after it was terminated.

Next, fix the service worker by removing its reliance on temporary state. Update the test-extension to use the following code, which is stored in service-worker-fixed.js in the repository.

service-worker-fixed.js:

Here, we save the version to chrome.storage.local instead of a global variable to persist the state between service worker lifetimes. Since storage can only be

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "puppeteer-demo",
  "version": "1.0",
  "dependencies": {
    "jest": "^29.7.0",
    "puppeteer": "^24.8.1"
  },
  "scripts": {
    "start": "jest ."
  },
  "devDependencies": {
    "@jest/globals": "^29.7.0"
  }
}
```

Example 2 (javascript):
```javascript
const puppeteer = require('puppeteer');

const SAMPLES_REPO_PATH = 'PATH_TO_SAMPLES_REPOSITORY';
const EXTENSION_PATH = `${SAMPLES_REPO_PATH}/functional-samples/tutorial.terminate-sw/test-extension`;
const EXTENSION_ID = 'gjgkofgpcmpfpggbgjgdfaaifcmoklbl';

let browser;

beforeEach(async () => {
  browser = await puppeteer.launch({
    // Set to 'new' to hide Chrome if running as part of an automated build.
    headless: false,
    pipe: true,
    enableExtensions: [EXTENSION_PATH]
  });
});

afterEach(async () => {
  await browser.close();
  browser = undefined;
});
```

Example 3 (javascript):
```javascript
let data;

chrome.runtime.onInstalled.addListener(() => {
  data = { version: chrome.runtime.getManifest().version };
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  sendResponse(data.version);
});
```

Example 4 (javascript):
```javascript
test('can message service worker', async () => {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${EXTENSION_ID}/page.html`);

  // Message without terminating service worker
  await page.click('button');
  await page.waitForSelector('#response-0');
});
```

---

## Register your extension for an origin trial Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/how-to/web-platform/origin-trials

**Contents:**
- Register your extension for an origin trial Stay organized with collections Save and categorize content based on your preferences.
- Find an active origin trial
- Determine your extension ID
- Register your extension
- Use the trial token
  - Extension origin
  - Content scripts

Origin trials are time-limited programs open to all developers, offering early access to experimental platform features. They can be used to test a new extension API or platform behavior before enabling it by default. Since they are time-limited, you should make sure your extension continues to work even if the trial becomes inactive.

Take a look at the full list of Chrome Origin Trials. Origin trials that are actively looking for developer feedback are usually shared proactively through blog posts or social media.

To register for an origin trial, you need to provide an extension ID.

To make sure your extension ID is the same both during development and when you publish your extension, follow the steps to keep a consistent extension ID. If your extension is already live in the Chrome Web Store, you can follow these steps for your existing extension listing instead of creating a new one.

On the page for a specific trial, click Register. Keep in mind the Chrome versions where the trial is available and the end date.

Provide your Chrome Extension origin in the "Web Origin" field, for example chrome-extension://abcdefghijklmnopqrstuvwxyz.

You will receive a token that you will need to use to enable the trial in your extension.

You can enable an origin trial for your extension origin or in a content script.

Some features may also require an API permission. Check the documentation for the specific trial to find out more.

To see if the trial has been enabled, check the Frames > Top tab of the Application panel in DevTools when inspecting a chrome-extension:// scheme page.

Content scripts run in the context of the page they are injected into, rather than your extension origin. As a result, origin trials for web features won't be active in your content script even if you have added a token to your extension manifest.

Instead, select the third-party matching option when creating a trial token:

Then, inject the token into the page:

The origin you inject into might not have been designed to run with this origin trial active. As a result, inject with caution and consider the potential impact of doing so.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-05-13 UTC.

**Examples:**

Example 1 (unknown):
```unknown
"trial_tokens": [
  "[TOKEN_HERE]"
]
```

Example 2 (javascript):
```javascript
const otMeta = document.createElement('meta');
otMeta.httpEquiv = 'origin-trial';
otMeta.content = 'TOKEN_GOES_HERE';
document.head.append(otMeta);
```

---

## The "activeTab" permission Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/concepts/activeTab

**Contents:**
- The "activeTab" permission Stay organized with collections Save and categorize content based on your preferences.
- Example
- Motivation
- What "activeTab" allows
- Invoking activeTab

The "activeTab" permission gives an extension temporary access to the currently active tab when the user invokes the extension - for example by clicking its action. Access to the tab lasts while the user is on that page, and is revoked when the user navigates away or closes the tab. For example, if the user invokes the extension on https://example.com and then navigates to https://example.com/foo, the extension will continue to have access to the page. If the user navigates to https://chromium.org, access is revoked.

This serves as an alternative for many uses of "<all_urls>", but displays no warning message during installation:

See the Page Redder sample extension:

Consider a web clipping extension that has an action and a context menu item. This extension may only really need to access tabs when its action is clicked, or when its context menu item is executed.

Without "activeTab", this extension would need to request full, persistent access to every website, just so that it could do its work if it happened to be called upon by the user. This is a lot of power to entrust to such a simple extension. And if the extension is ever compromised, the attacker gets access to everything the extension had.

In contrast, an extension with the "activeTab" permission only obtains access to a tab in response to an explicit user gesture. If the extension is compromised the attacker would need to wait for the user to invoke the extension before obtaining access. And that access only lasts until the tab is navigated or is closed.

While the "activeTab" permission is enabled for a tab, an extension can:

The following user gestures enable the "activeTab" permission:

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2012-09-21 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Page Redder",
  "version": "2.0",
  "permissions": [
    "activeTab",
    "scripting"
  ],
  "background": {
    "service_worker": "service-worker.js"
  },
  "action": {
    "default_title": "Make this page red"
  },
  "manifest_version": 3
}
```

Example 2 (javascript):
```javascript
function reddenPage() {
  document.body.style.backgroundColor = 'red';
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab.url.includes('chrome://')) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: reddenPage
    });
  }
});
```

---

## What's new in Chrome extensions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/whats-new#chrome_139_removing_--extensions-on-chrome-urls_and_--disable-extensions-except_flags_in_chrome_branded_builds

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

## Use WebSockets in service workers Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets

**Contents:**
- Use WebSockets in service workers Stay organized with collections Save and categorize content based on your preferences.
- Background
- Example: WebSocket keepalive

This tutorial demonstrates how to connect to a WebSocket in your Chrome extension's service worker. You can find a working example on Github.

Starting with Chrome 116, extension service workers get improved support for WebSockets. Previously, a service worker could become inactive despite a WebSocket connection being active if no other extension events occurred for 30 seconds. This would terminate the service worker and close the WebSocket connection. For more background on the extension service worker lifecycle, read the extension service worker guide).

From Chrome 116 on, you can keep a service worker with a WebSocket connection active by exchanging messages within the 30s service worker activity window. These can either be initiated from your server or from your extension. In the following example, we will send a regular message from the Chrome extension to the server to ensure that the service worker stays alive.

First we need to make sure that our extension only runs in Chrome versions supporting WebSockets in service workers by setting the minimum Chrome version to 116 in the manifest:

Then we can keep the service worker active by sending a keepalive message every 20s. The keepalive is started once the service worker connects to the WebSocket. The following sample WebSocket client logs messages and calls keepAlive() when the onopen event is triggered:

Inside keepAlive() we use setInterval(...) to regularly send a ping to the server while there is an active WebSocket connection:

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-07-04 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  ...
  "minimum_chrome_version": "116",
  ...
}
```

Example 2 (javascript):
```javascript
let webSocket = null;

function connect() {
  webSocket = new WebSocket('wss://example.com/ws');

  webSocket.onopen = (event) => {
    console.log('websocket open');
    keepAlive();
  };

  webSocket.onmessage = (event) => {
    console.log(`websocket received message: ${event.data}`);
  };

  webSocket.onclose = (event) => {
    console.log('websocket connection closed');
    webSocket = null;
  };
}

function disconnect() {
  if (webSocket == null) {
    return;
  }
  webSocket.close();
}
```

Example 3 (javascript):
```javascript
function keepAlive() {
  const keepAliveIntervalId = setInterval(
    () => {
      if (webSocket) {
        webSocket.send('keepalive');
      } else {
        clearInterval(keepAliveIntervalId);
      }
    },
    // Set the interval to 20 seconds to prevent the service worker from becoming inactive.
    20 * 1000
  );
}
```

---

## What's new in Chrome extensions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/whats-new#chrome_138_changes_to_the_new_tab_page

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

## Real-time updates in Extensions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/concepts/real-time

**Contents:**
- Real-time updates in Extensions Stay organized with collections Save and categorize content based on your preferences.
- Common scenarios
  - Keep users up-to-date with changes.
  - Send notifications to users.
  - Instant Messaging
- Push notifications with the Push API
- Push notifications with chrome.gcm
- Real time messages with WebSockets
  - Not great for push notifications
  - Active connections only

Real-time updates provide an instant communication path from your servers directly to your extension installations. You can send and receive data as events happen. Whether you use it for instant messaging, triggering background tasks, or syncing device data, it is a critical operation with a number of modern services. There are a number of options to have real-time communication in Chrome extensions.

Here are some common scenarios in Chrome extensions where real-time communication is critical:

If you are syncing files, settings, or other pieces of information between multiple users then Web Push is the perfect way to send silent updates to your extension to let it know to update the state from the server.

Are you letting users report bugs or issues? You can integrate with a Push provider to let them know as soon as you have an update to share, directly in your extension.

While you can send notifications completely client side, if you have server side logic for who, what, where or when to send a notification than Web Push is the most future proof option.

For sending messages to a only a subset of users, then Push is the best choice. While Firebase Cloud Messaging does offer Topics (also known as channels), it is only available in their HTTP Cloud Messaging API. This is different from the legacy version that chrome.gcm uses. If you want to send broad messages to all users, including those on legacy versions of Chrome (pre Chrome 121), then chrome.gcm is the ideal option. Built on the Legacy Firebase messaging APIs, chrome.gcm has been supported in Chrome for over a decade.

You can use Web Push or chrome.gcm to send notifications to users when something important to their account happens, such as when a new message arrives or when a file is shared.

Need frequent, two way communication? Then a web socket may be the best option for you. It opens a bidirectional connection between your extension and your server (or even directly to other users). It lets you exchange data and messages in real time. While they are a great option on the web in general, they have some limitations with extensions that you need to keep in mind if you plan on using them.

In the rest of this guide we will take a closer look at the available options.

Using the Push API you can use any Push provider to send push notifications and messages. A push from the Push API will be processed by your service worker as soon as it is received. If the extension has been suspended, a Push will 

*[Content truncated]*

---

## Self-host for Linux Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/how-to/distribute/host-extensions

**Contents:**
- Self-host for Linux Stay organized with collections Save and categorize content based on your preferences.
- Package
  - Download .crx from the Chrome Web Store
  - Create .crx locally
  - Update a .crx package
  - Package through command line
- Host
- Update
  - Update URL
  - Update manifest

Linux is the only platform where Chrome users can install extensions that are hosted outside of the Chrome Web Store. This article describes how to package, host, and update crx files from a general purpose web server. If you are distributing an extension or theme solely through the Chrome Web Store, consult Webstore hosting and updating.

Extensions and themes are served as .crx files. When uploading through the Chrome Developer Dashboard, the dashboard creates the crx file automatically. If published on a personal server, the crx file will need to be created locally or downloaded from the Chrome Web Store.

If an extension is hosted on the Chrome Web Store, the .crx file can be downloaded from the Developer Dashboard. Locate the extension under "Your Listings" and click "More info". In the popup window, click the blue main.crx link to download it.

The downloaded file can be hosted on a personal server. This is the most secure way to host an extension locally as the contents of the extension will be signed by the Chrome Web Store. This helps detect potential attacks and tampering.

Extension directories are converted to .crx files at the Extensions Management Page. Navigate to chrome://extensions/ in the omnibox, or click the Chrome menu, hold the pointer over "More Tools" then select "Extensions".

On the Extensions Management Page, enable Developer Mode by clicking the toggle switch next to Developer mode. Then select the PACK EXTENSION button.

Specify the path to the extension's folder in the Extension root directory field then click the PACK EXTENSION button. Ignore the Private key field for a first-time package.

Chrome will create two files, a .crx file and a .pem file, which contains the extension's private key.

Do not lose the private key! Keep the .pem file in a secret and secure place; it will be needed to update the extension.

Update an extension's .crx file by increasing the version number in manifest.json.

Return to the Extensions Management Page and click the PACK EXTENSION button. Specify the path to the extensions directory and the location of private key.

The page will provide the path for the updated packaged extension.

Package extensions in the command line by invoking chrome.exe. Use the --pack-extension flag to specify the location of the extension's folder and the --pack-extension-key flag to specify the location of the extension's private key file.

A server that hosts .crx files must use appropriate HTTP headers to allow use

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  ...
  "version": "1.5",
  ...
  }
}
```

Example 2 (unknown):
```unknown
{
  ...
  "version": "1.6",
  ...
  }
}
```

Example 3 (unknown):
```unknown
chrome.exe --pack-extension=C:\myext --pack-extension-key=C:\myext.pem
```

Example 4 (unknown):
```unknown
{
  "name": "My extension",
  ...
  "update_url": "https://myhost.com/mytestextension/updates.xml",
  ...
}
```

---

## 

**URL:** https://developer.chrome.com/docs/extensions/reference

**Contents:**
  - Reference
- API reference
    - chrome.action
    - chrome.alarms
    - chrome.commands
    - chrome.declarativeNetRequest
    - chrome.offscreen
    - chrome.runtime
    - chrome.scripting
    - chrome.sidePanel

---

## File an extension bug Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/support/file-a-bug

**Contents:**
- File an extension bug Stay organized with collections Save and categorize content based on your preferences.

While developing an extension, you may find behavior that does not match the extension's documentation or is otherwise unexpected. This may be the result of a Chrome bug or something we should add to the documentation. Regardless, let us know by filing an appropriate issue report. Provide enough information to reproduce the issue by following these steps:

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-10-11 UTC.

---

## 

**URL:** https://developer.chrome.com/docs/extensions

**Contents:**
  - Welcome to Extensions!
  - Extensions and AI
    - The Prompt API in Chrome Extensions
    - AI-powered extensions samples
    - Early Preview Program
    - Join the Built-in AI Challenge
  - What's New
    - New guide explaining the Extensions update cycle
    - Chrome 140: New `sidePanel.getLayout()` API
    - Chrome 139: Removing `--extensions-on-chrome-urls` and `--disable-extensions-except` flags in Chrome branded builds

---

## Make your extension accessible Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/ui/a11y

**Contents:**
- Make your extension accessible Stay organized with collections Save and categorize content based on your preferences.

For many users, accessibility literally is the user interface, and its features can often be useful to those who don't need accessibility as a primary means of interacting with your extension. The techniques are varied. At the very least, text should be high-contrast. Videos should captioned. Images should include alt attributes.

But, as stated, this is just the minimum. Additional techniques are described in what follows.

There are a few ways to implement accessibility, but the easiest is to use a standard HTML control, particularly the input elements. The following image shows these controls.

To make other elements accessible, use ARIA attributes. These attributes provide information to the screen reader about the function and current state of controls on a web page. Here is an example.

By default, the only elements in the HTML DOM that can receive keyboard focus are anchors, buttons, and form controls. Fortunately, setting the tabIndex attribute on an HTML element lets it receive keyboard focus. For example:

For instructions on implementing these techniques and more, see Support accessibility.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2024-02-29 UTC.

**Examples:**

Example 1 (unknown):
```unknown
<div role="toolbar" tabindex="0" aria-activedescendant="button1">
  <img src="buttoncut.png" role="button" alt="cut" id="button1">
  <img src="buttoncopy.png" role="button" alt="copy" id="button2">
  <img src="buttonpaste.png" role="button" alt="paste" id="button3">
</div>
```

Example 2 (unknown):
```unknown
<div tabindex="0">I can receive focus with the tab key.</div>
```

---

## 

**URL:** https://developer.chrome.com/docs/extensions/how-to

**Contents:**
  - How to...
- Categories
  - Design the user interface
    - Support accessibility
    - Use favicons
    - Localize your extension
    - Notify users
    - Extend DevTools
  - Use the web platform
    - Handle files on Chrome OS

---

## 

**URL:** https://developer.chrome.com/docs/extensions/ai

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

## Find and follow a bug Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/support/find-a-bug

**Contents:**
- Find and follow a bug Stay organized with collections Save and categorize content based on your preferences.

Before filing a bug or submitting a feature request for extensions, you should check whether either has already been reported by checking open Chromium issues. These issues are kept in the Chromium issue tracker. This database lets you search for and follow any issue that's been reported for Chromium.

Don't respond to any bugs or feature requests by saying "me too." Use the Chrome Extensions Mailing List for updates on when a bug will be fixed. However, if you have valuable information, such as a better test case or a suggested fix, add a comment.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-10-11 UTC.

---

## Submit a feature request Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/support/request-feature

**Contents:**
- Submit a feature request Stay organized with collections Save and categorize content based on your preferences.

If you identify a feature that you believe could improve the extension platform, file a request as described below.

File an issue in the issue tracker. Be as explicit as possible when filling out a feature request.

The better we understand your use case and your needs, the easier it will be to meet them.

Wait for the bug to be updated. Most requests are triaged within a week, although it can sometimes take longer. Please do not reply to the ticket requesting an update. If your ticket has not been modified after two weeks, post a message to the Chrome Extensions Mailing List with a link to your request.

If you originally posted your request in the discussion group and were directed here, post a link to the issue you created or found in the discussion group thread. This makes it easier for others with the same request to find the correct ticket.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-10-11 UTC.

---

## 

**URL:** https://developer.chrome.com/docs/extensions/mv3/devguide/

**Contents:**
  - Develop
- Design the user interface
  - Side panel
  - Action
  - Menus
- Control the browser
  - Override Chrome pages and settings
  - Extending DevTools
  - Display notifications
  - Manage history

---

## Get help with Chrome Extensions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/support/get-help

**Contents:**
- Get help with Chrome Extensions Stay organized with collections Save and categorize content based on your preferences.
- For extensions development
- For Chrome Web Store

We do our best to improve the content of this site and of the Chrome Web Store help. Some of you might run into problems we don't cover. Fortunately, there are other ways for you to get help.

Use our One Stop Support page to get help with issues related to your Chrome Web Store account or items.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-02-21 UTC.

---

## Override Chrome pages Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages

**Contents:**
- Override Chrome pages Stay organized with collections Save and categorize content based on your preferences.
- Incognito window behavior
- Manifest
- Best practices
- Examples

Extensions can use HTML override pages to replace a page Google Chrome normally provides. An extension can contain an override for any of the following pages, but each extension can only override one page:

The following screenshots show the default New Tab page and then a custom New Tab page.

To try this out, see our override samples.

In incognito windows, extensions can't override New Tab pages. Other pages still work if the incognito manifest property is set to "spanning" (the default value). For details on how to handle incognito windows, see Saving data and incognito mode.

Use the following code to register an override page in the extension manifest:

For PAGE_TO_OVERRIDE, substitute one of the following:

Make your page quick and small. Users expect built-in browser pages to open instantly. Avoid doing things that might take a long time. Specifically, avoid accessing database resources synchronously. When making network requests, prefer fetch() over XMLHttpRequest().

To avoid user confusion, give your page a title. Without a title, the page title defaults to the URL. Specify the title using the <title> tag in your HTML file.

Remember that new tabs give keyboard focus to the address bar first. Don't rely on keyboard focus defaulting to other parts of the page.

Make the new tab page your own. Avoid creating a new tab page which users may confuse with Chrome's default new tab page.

See the override samples.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2012-09-18 UTC.

**Examples:**

Example 1 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "My extension",
  ...

  "chrome_url_overrides" : {
    "PAGE_TO_OVERRIDE": "myPage.html"
  },
  ...
}
```

---

## What's new in Chrome extensions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/whats-new

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

## 

**URL:** https://developer.chrome.com/docs/extensions/develop

**Contents:**
  - Develop
- Design the user interface
  - Side panel
  - Action
  - Menus
- Control the browser
  - Override Chrome pages and settings
  - Extending DevTools
  - Display notifications
  - Manage history

---

## 

**URL:** https://developer.chrome.com/docs/extensions/reference/

**Contents:**
  - Reference
- API reference
    - chrome.action
    - chrome.alarms
    - chrome.commands
    - chrome.declarativeNetRequest
    - chrome.offscreen
    - chrome.runtime
    - chrome.scripting
    - chrome.sidePanel

---

## Writing Extensions for Chrome: A Developer's Guide

**URL:** https://daily.dev/blog/writing-extensions-for-chrome-a-developers-guide

**Contents:**
  - What are Chrome Extensions?
  - Why Develop Writing Productivity Extensions?
- Setting Up Your Development Environment
  - Prerequisites
  - Installing Necessary Tools
- Building Your First Chrome Extension
  - Creating the Manifest File
  - Developing Background Scripts
  - Implementing Content Scripts
  - Adding a User Interface

Creating Chrome extensions is a powerful way to enhance your browsing experience, especially for tasks like writing and research. Here's a quick guide on getting started:

Whether you're a seasoned developer or new to web development, creating Chrome extensions is an accessible way to contribute useful tools for writers and other users.

Chrome extensions help you do more with your Google Chrome browser. They are like small programs made using website building blocks - HTML, CSS, and JavaScript. Here's what you need to know:

In short, Chrome extensions let you mix your code into Chrome to make browsing better. There's a lot you can do with them!

If you write a lot or make websites, you know how much time you spend in your browser. Extensions that help with writing can make a big difference. Here's why making extensions for writers is a great idea:

By using the Chrome extension framework, you can create all sorts of tools to tackle common writing challenges. It's a great way to help writers do their best work.

Before you start making Chrome extensions, you need a few things:

That's all you need to begin. Later on, you might find tools like Git and Node.js useful, but to start, the above are enough.

Here’s how you get ready to build your extension:

And that's it! With these steps, you're ready to make your own Chrome extensions. Now you can start creating features to improve your Chrome experience.

Creating your own Chrome extension can feel a bit complex at first, but if you take it step by step, you'll soon be adding cool features to your browser. Let's go through making a simple extension together to get the hang of it.

Every extension needs a manifest.json file. It's like an ID card for your extension, telling Chrome what it's called, what version it is, and what it can do. Here's a simple example:

You can find more details in the official documentation.

Background scripts are like the behind-the-scenes crew of your extension. They listen for things to happen and then act. For example, here's a script that does something when you click the extension's icon:

The background.service_worker.js file is where these scripts live, acting as a service worker to keep an eye on events.

Content scripts let your extension chat directly with a webpage. For instance, if you want to play with the text on a page, you might use this:

The content_scripts part of your manifest file tells Chrome when and where to use these scripts.

Popups are a simple way to a

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "My First Extension",
  "version": "1.0",
  "manifest_version": 3,
  "permissions": ["tabs"]
}
```

Example 2 (js):
```js
chrome.action.onClicked.addListener(() => {


  // Do something

});
```

Example 3 (js):
```js
// content.js
const paragraphs = document.getElementsByTagName('p');

// Do stuff with paragraphs
```

Example 4 (html):
```html
<!-- popup.html -->
<button id="myButton">Click me!</button>

<script src="popup.js"></script>
```

---
