const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Skip notarization if environment variables are not set
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.SKIP_NOTARIZATION === 'true') {
    console.log('Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD not set or SKIP_NOTARIZATION is set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.time('Notarization');
  console.log(`Notarizing ${appName}...`);

  try {
    await notarize({
      appBundleId: 'com.echolon.app',
      appPath: `${appOutDir}/${appName}.app`,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    });
    console.timeEnd('Notarization');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};

