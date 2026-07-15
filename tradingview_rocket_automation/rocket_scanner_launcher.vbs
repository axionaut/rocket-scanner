Option Explicit

Dim fso, shell, root, action, pythonExe, scriptPath, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
action = ""
If WScript.Arguments.Count > 0 Then action = LCase(WScript.Arguments(0))

If InStr(action, "rocket-scanner://run-day") > 0 Then
    pythonExe = fso.BuildPath(root, ".venv\Scripts\pythonw.exe")
    scriptPath = fso.BuildPath(root, "tradingview_rocket_automation.py")
    command = Quote(pythonExe) & " " & Quote(scriptPath)
    shell.Run command, 0, False
ElseIf InStr(action, "rocket-scanner://pause") > 0 Then
    WriteControlFile fso.BuildPath(root, "automation_pause.txt"), "paused"
ElseIf InStr(action, "rocket-scanner://resume") > 0 Then
    DeleteIfPresent fso.BuildPath(root, "automation_pause.txt")
ElseIf InStr(action, "rocket-scanner://stop") > 0 Then
    WriteControlFile fso.BuildPath(root, "automation_stop.txt"), "stop"
End If

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function

Sub WriteControlFile(path, value)
    Dim stream
    Set stream = fso.CreateTextFile(path, True, False)
    stream.WriteLine value
    stream.Close
End Sub

Sub DeleteIfPresent(path)
    If fso.FileExists(path) Then fso.DeleteFile path, True
End Sub
