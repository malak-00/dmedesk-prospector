# Chrome-Extension - Runtime

**Pages:** 1

---

## Use Firebase Cloud Messaging (FCM) with chrome.gcm Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/how-to/integrate/chrome.gcm

**Contents:**
- Use Firebase Cloud Messaging (FCM) with chrome.gcm Stay organized with collections Save and categorize content based on your preferences.
- Prerequisites
- Configure chrome.gcm
- Listen for messages
- Firebase without Firebase
- On Channels and Topics

You can send and receive messages to end users with chrome.gcm. Because it is built on top of Firebase Cloud Messaging (FCM), it relies on an external service you need to set up. This how-to walks you through all of the necessary steps to get it working in your extension.

While chrome.gcm is still supported, it was created over a decade ago before the Push standard. In general, it is always best practice to use the web standard, rather than an extension specific API. Unless you have a specific need to use chrome.gcm, we recommend using Push.

In order to use chrome.gcm, you will need to set up a Firebase account.

Once you have an account created, you will want to open your Firebase console, and select an existing project to use, or create a new one for your extension.

Continue to the settings page for Cloud Messaging.

If you have an existing cloud messaging account on this project, you want to copy the numeric Sender ID listed.

If you don't have cloud messaging enabled, you will need to enable the Firebase Cloud Messaging API for the project inside of Google Cloud. In the following image, you can see where there is a link directly to this page on the Firebase settings.

Once enabled, return back to the settings page for Cloud Messaging, and copy the Sender ID.

Now that you have your Sender Id from Firebase, you can configure your extension to listen for messages. To begin with, ensure that you have added the gcm permission to your extension's manifest.json

You now have access to the chrome.gcm API. You can register to listen for push messages by calling chrome.gcm.register

Once the extension registered your Sender ID, you need to add code to handle incoming messages.

While chrome.gcm always goes through Firebase, Firebase can be configured to act as a proxy for external push messaging vendors. Typically vendors will explicitly list support for Chrome Extensions, however any vendor that supports Firebase's Legacy push notifications should work. If your provider lists support for Firebase's Legacy push notifications, try it out. If you experience problems, the providers support should be able to clarify any restrictions that would be in place.

chrome.gcm is using the legacy Firebase Messaging APIs. This is important because the legacy API does not support message channels. Every message pushed will go to every client. If a user's extension is only interested in a subset of messages, you will need to filter yourself.

While Firebase begins as a free

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
  {
    "manifest_version": 3,
    ...
    "permissions": ["gcm"]
```

---
