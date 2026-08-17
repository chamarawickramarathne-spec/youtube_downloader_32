[Setup]
AppName=YouTube Fetcher
AppVersion=1.2.7
AppPublisher=YouTube Fetcher
DefaultDirName={autopf}\YouTube Fetcher
DefaultGroupName=YouTube Fetcher
OutputDir=release
OutputBaseFilename=YouTubeFetcher
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x86compatible
ArchitecturesInstallIn64BitMode=x86compatible
UninstallDisplayName=YouTube Fetcher
UninstallDisplayIcon={app}\YouTubeFetcher.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "dist\YouTubeFetcher.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "resources\*"; DestDir: "{app}\resources"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\YouTube Fetcher"; Filename: "{app}\YouTubeFetcher.exe"
Name: "{group}\Uninstall YouTube Fetcher"; Filename: "{uninstallexe}"
Name: "{autodesktop}\YouTube Fetcher"; Filename: "{app}\YouTubeFetcher.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\YouTubeFetcher.exe"; Description: "Launch YouTube Fetcher"; Flags: nowait postinstall skipifsilent
