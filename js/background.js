// Constants & variables
var MANIFEST = browser.runtime.getManifest()     // Manifest reference
    , OLD_STORAGE_KEY = 'autoTextExpanderShortcuts' // For shortcut DB migration
    , OLD_SHORTCUT_VERSION_KEY = 'v'            // For shortcut DB migration
    , TEST_OLD_APP_VERSION                      // For testing upgrades from older versions
    , shortcutCache = {}                        // Cache for shortcuts
    ;
console.log('Initializing ATE v' + MANIFEST.version, browser.i18n.getMessage('@@ui_locale'));

// Custom log function
function debugLog() {
    if (DEBUG && console) {
        console.log.apply(console, arguments);
    }
}


//////////////////////////////////////////////////////////
// ACTIONS

// Listen for whether or not to show the pageAction icon
browser.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    debugLog(request);
    debugLog(sender);

    switch (request.request) {
        case "getClipboardData":
            sendResponse({ paste: pasteFromClipboard() });
            break;

        default:
            console.log("Unknown request received:", request);
            break;
    }
});


// On first install or upgrade, make sure to inject into all tabs
browser.runtime.onInstalled.addListener(function (details) {

    // On first install
    if (details.reason == "install") {
        // Open up options page
        browser.tabs.create({ url: "options.html" });

        // Inject script into all open tabs
        browser.tabs.query({}, function (tabs) {
            debugLog("Executing on tabs: ", tabs);
            for (var i = 0, l = tabs.length; i < l; ++i) {
                injectScript(tabs[i]);
            }
        });
    }

    // If upgrading to new version number
    else if (details.reason == "update" && details.previousVersion != MANIFEST.version) {
        processVersionUpgrade(details.previousVersion);
    }

    else    // All other - reloaded extension
    {
        // Run testing if need be

        // Check synced shortcuts in case of need to update, show options, etc.
        browser.storage.sync.get(null, function (data) {
            debugLog('checking shortcuts...');

            if (browser.runtime.lastError) {	// Check for errors
                console.log(browser.runtime.lastError);
            } else if (!data || Object.keys(data).length == 0) {
                // If no shortcuts exist, show options page (should show emergency backup restore)
                browser.tabs.create({ url: "options.html" });
            } else if (data[SHORTCUT_VERSION_KEY]
                && data[SHORTCUT_VERSION_KEY] != MANIFEST.version) {
                // If version is off, try to initiate upgrade
                processVersionUpgrade(data[SHORTCUT_VERSION_KEY]);
            }
        });

    }
});

browser.browserAction.onClicked.addListener(function (tab) {
    openOrFocusOptionsPage();
});


//////////////////////////////////////////////////////////
// FUNCTIONS

// Execute our content script into the given tab
function injectScript(tab) {
    // Insanity check
    if (!tab || !tab.id) {
        console.log("Injecting into invalid tab:", tab);
        return;
    }

    // Loop through content scripts and execute in order
    var contentScripts = MANIFEST.content_scripts[0].js;
    for (var i = 0, l = contentScripts.length; i < l; ++i) {
        browser.tabs.executeScript(tab.id, {
            file: contentScripts[i]
        });
    }
}

// Get paste contents from clipboard
function pasteFromClipboard() {
    // Create element to paste content into
    document.querySelector('body').innerHTML += '<textarea id="clipboard"></textarea>';
    var clipboard = document.getElementById('clipboard');
    clipboard.select();

    // Execute paste
    var result;
    if (document.execCommand('paste', true)) {
        result = clipboard.value;
    }

    // Cleanup and return value
    clipboard.parentNode.removeChild(clipboard);
    return result;
}

// Opens or focuses on the options page if open
function openOrFocusOptionsPage(params) {
    // Check params is valid string
    if (!params) {
        params = "";
    }

    // Get the url for the extension options page
    var optionsUrl = browser.extension.getURL('options.html');
    browser.tabs.query({ 'url': optionsUrl }, function (tabs) {
        if (tabs.length)    // If options tab is already open, focus on it
        {
            debugLog("options page found:", tabs[0].id);
            browser.tabs.update(tabs[0].id, {
                selected: true,
                url: optionsUrl + params,
            });
        }
        else {  // Open the options page otherwise
            browser.tabs.create({ url: optionsUrl + params });
        }
    });
}

// Function for anything extra that needs doing related to new version upgrade
function processVersionUpgrade(oldVersion) {
    debugLog('processVersionUpgrade:', oldVersion);

    // Make backup of synced data before proceeding
    makeEmergencyBackup(function () {

    });
}

// Make backup of all saved synced data
function makeEmergencyBackup(completionBlock) {
    browser.storage.sync.get(null, function (data) {
        if (browser.runtime.lastError) 	 // Check for errors
        {
            console.log("SERIOUS ERROR: COULD NOT MAKE EMERGENCY BACKUP BEFORE UPGRADE");
            console.log(browser.runtime.lastError);
        }
        else   // Store backup into emergency local storage
        {
            // Setup backup
            var backup = {};
            backup[APP_EMERGENCY_BACKUP_KEY] = data;
            browser.storage.local.set(backup, function () {
                if (browser.runtime.lastError) 	// Check for errors
                {
                    console.log("SERIOUS ERROR: COULD NOT MAKE EMERGENCY BACKUP BEFORE UPGRADE");
                    console.log(browser.runtime.lastError);
                }
                else 	// Backup success
                {
                    debugLog("Emergency backup before migration created.");
                    if (completionBlock) {
                        completionBlock();
                    }
                }
            });
        }
    });
}

// Restore synced data from emergency backup
function restoreEmergencyBackup(completionBlock) {
    browser.storage.local.get(APP_EMERGENCY_BACKUP_KEY, function (data) {
        if (browser.runtime.lastError) 	 // Check for errors
        {
            console.log("SERIOUS ERROR: COULD NOT GET EMERGENCY BACKUP");
            console.log(browser.runtime.lastError);
        }
        else   // Restore backup to synced storage
        {
            browser.storage.sync.set(data[APP_EMERGENCY_BACKUP_KEY], function () {
                if (browser.runtime.lastError) 	// Check for errors
                {
                    console.log("SERIOUS ERROR: COULD NOT RESTORE EMERGENCY BACKUP");
                    console.log(browser.runtime.lastError);
                }
                else 	// Restore success
                {
                    debugLog("Emergency backup restored.");
                    if (completionBlock) {
                        completionBlock();
                    }
                }
            });
        }
    });
}


// Updates the shortcut database with the latest version number, and support an optional message
function upgradeShortcutsToLatest(upgradeNotesList) {
    console.log("upgradeShortcutsToLatest:", upgradeNotesList);

    // Upgrade shortcut database version
    browser.storage.sync.get(null, function (data) {
        if (browser.runtime.lastError) {	// Check for errors
            console.log(browser.runtime.lastError);
        }
        else if (data && Object.keys(data).length) // Check that data is returned
        {
            console.log("updating database version to", MANIFEST.version);

            // Update metadata for shortcut version to manifest version
            data[SHORTCUT_VERSION_KEY] = MANIFEST.version;

            // Delete old data, replace with new data
            browser.storage.sync.clear(function () {
                if (browser.runtime.lastError) { 	// Check for errors
                    console.log(browser.runtime.lastError);
                } else {
                    browser.storage.sync.set(data, function () {
                        if (browser.runtime.lastError) 	// Check for errors
                        {
                            console.log(browser.runtime.lastError);
                            restoreEmergencyBackup();
                        }
                        else	// Done with migration
                        {
                            debugLog("upgrade complete!");

                            // Add upgrade message
                            upgradeNotesList.unshift({
                                title: "Please reload tabs.",
                                message: ""
                            });
                        }
                    });
                }
            });
        }
    });
}
