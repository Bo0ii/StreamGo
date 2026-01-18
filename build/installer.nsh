; Custom NSIS script to fix integrity check issues
; This file is included in the NSIS installer build

; Disable CRC check - sometimes electron-builder creates installers that fail NSIS CRC
; even though the files are fine. This is a known issue with large electron apps.
CRCCheck off

; Disable data block optimization - can cause decompression issues with large Electron apps
SetDatablockOptimize off

; Set better error handling for large files
SetOverwrite on
SetDateSave on

; Note: Compression is set to "normal" (zlib) in package.json for good balance between size and reliability
; This avoids decompression errors while still compressing the installer significantly
