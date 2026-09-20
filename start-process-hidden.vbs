Option Explicit

Dim workDir
Dim command
Dim stdoutPath
Dim stderrPath
Dim pidPath
Dim commandLine
Dim shell

workDir = WScript.Arguments(0)
command = WScript.Arguments(1)
stdoutPath = WScript.Arguments(2)
stderrPath = WScript.Arguments(3)
pidPath = WScript.Arguments(4)

' Use pushd instead of "cd /d": the working directory may be a UNC path
' (\\server\share\...). CMD refuses to use a UNC path as the current
' directory, so "cd /d" fails and the command after "&&" never runs
' (double-clicking start.bat then appears to do nothing). pushd maps a
' temporary drive letter for a UNC path automatically, so the directory
' change succeeds.
commandLine = "cmd.exe /d /c pushd " & Quote(workDir) & " && " & command & " >> " & Quote(stdoutPath) & " 2>> " & Quote(stderrPath)

Set shell = CreateObject("WScript.Shell")
shell.Run commandLine, 0, False

Function Quote(value)
    Quote = """" & Replace(value, """", """""") & """"
End Function
