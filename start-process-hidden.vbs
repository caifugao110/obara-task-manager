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

commandLine = "cmd.exe /d /c cd /d " & Quote(workDir) & " && " & command & " >> " & Quote(stdoutPath) & " 2>> " & Quote(stderrPath)

Set shell = CreateObject("WScript.Shell")
shell.Run commandLine, 0, False

Function Quote(value)
    Quote = """" & Replace(value, """", """""") & """"
End Function
