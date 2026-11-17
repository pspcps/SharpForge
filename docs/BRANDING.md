# Cairn IDE identity

Cairn IDE is the new display name for the SharpForge project. The simplified geometric C and teal diamond icon was generated for this project in response to feedback that the original detailed mark was unclear at small sizes. The production PNG has transparent corners and is shared by the app bundle, DMG, toolbar and browser icon entry points.

Compatibility identifiers deliberately remain stable: `org.sharpforge.ide`, `.sharpforge` support directories, `sharpforge.*` browser storage keys, existing theme IDs and log directory. Electron reuses an existing SharpForge/sharpforge user-data profile for preferences and file history. These internal identifiers do not indicate incomplete visible branding. Historical copyright notices are retained. The source repository URL remains https://github.com/pspcps/SharpForge.

The installer builds `Cairn IDE.app` under `release/mac-arm64/` or `release/mac/`. Keep the original application installed until the renamed build has been tested with your existing workspace. Validate app/DMG icons, Finder file associations, settings and file history on macOS before release. Branding approval does not constitute trademark clearance.
