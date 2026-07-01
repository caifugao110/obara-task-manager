Option Explicit

Dim scriptPath
Dim stdoutPath
Dim stderrPath
Dim command
Dim shell

scriptPath = WScript.Arguments(0)
stdoutPath = WScript.Arguments(1)
stderrPath = WScript.Arguments(2)

command = "cmd.exe /d /c call " & Quote(scriptPath) & " --hidden >> " & Quote(stdoutPath) & " 2>> " & Quote(stderrPath)

Set shell = CreateObject("WScript.Shell")
shell.Run command, 0, False

Function Quote(value)
    Quote = """" & Replace(value, """", """""") & """"
End Function
