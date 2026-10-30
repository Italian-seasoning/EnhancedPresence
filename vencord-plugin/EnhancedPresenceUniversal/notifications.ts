/* Licensed under GPL-3.0-or-later. */
export const desktopNotificationPatch = {
    find: '"NotificationStore"',
    replacement: {
        match: /(\i\.\i\.getDesktopType\(\)===\i\.\i\.NEVER)\)/,
        replace: "$&if(!$self.shouldShowDesktopNotification(arguments[0]?.message))return;else "
    }
};
