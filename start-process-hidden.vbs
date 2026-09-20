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

' 用 pushd 而不是 cd /d：工作目录可能是 UNC 路径（\\server\share\...），
' 而 CMD 不支持把 UNC 路径当作当前目录，cd /d 会失败并让 "&&" 之后的启动
' 命令完全不执行（表现为双击 start.bat 后毫无反应）。pushd 会自动为 UNC
' 路径映射一个临时盘符，因此可以正常切换工作目录。
commandLine = "cmd.exe /d /c pushd " & Quote(workDir) & " && " & command & " >> " & Quote(stdoutPath) & " 2>> " & Quote(stderrPath)

Set shell = CreateObject("WScript.Shell")
shell.Run commandLine, 0, False

Function Quote(value)
    Quote = """" & Replace(value, """", """""") & """"
End Function
