param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $Payload
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class WindowsJobRunner
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const uint INFINITE = 0xFFFFFFFF;
    private const uint WAIT_FAILED = 0xFFFFFFFF;
    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const int JobObjectExtendedLimitInformation = 9;
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST = new IntPtr(0x0002000D);
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public uint cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,
        uint informationLength
    );

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFOEX startupInfo,
        out PROCESS_INFORMATION processInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref IntPtr size
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        IntPtr size,
        IntPtr previousValue,
        IntPtr returnSize
    );

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForMultipleObjects(
        uint count,
        [In] IntPtr[] handles,
        bool waitAll,
        uint milliseconds
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int standardHandle);

    private static Win32Exception Failure(string operation)
    {
        return new Win32Exception(Marshal.GetLastWin32Error(), operation + " failed");
    }

    private static string QuoteArgument(string argument)
    {
        if (argument.Length == 0) return "\"\"";
        if (argument.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '\"' }) < 0) return argument;

        var quoted = new StringBuilder();
        quoted.Append('\"');
        var backslashes = 0;
        foreach (var character in argument)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }

            if (character == '\"')
            {
                quoted.Append('\\', backslashes * 2 + 1);
                quoted.Append('\"');
                backslashes = 0;
                continue;
            }

            quoted.Append('\\', backslashes);
            backslashes = 0;
            quoted.Append(character);
        }
        quoted.Append('\\', backslashes * 2);
        quoted.Append('\"');
        return quoted.ToString();
    }

    private static StringBuilder CommandLine(string executable, string[] arguments)
    {
        var commandLine = new StringBuilder(QuoteArgument(executable));
        foreach (var argument in arguments)
        {
            commandLine.Append(' ');
            commandLine.Append(QuoteArgument(argument));
        }
        return commandLine;
    }

    public static int Run(
        string executable,
        string[] arguments,
        string currentDirectory,
        string lifetimePipe
    )
    {
        NamedPipeClientStream lifetime = null;
        IAsyncResult lifetimeRead = null;
        WaitHandle lifetimeWait = null;
        var attributeList = IntPtr.Zero;
        var attributeListSize = IntPtr.Zero;
        var jobList = IntPtr.Zero;
        var job = IntPtr.Zero;
        var processInformation = new PROCESS_INFORMATION();
        var processCreated = false;

        try
        {
            lifetime = new NamedPipeClientStream(
                ".",
                lifetimePipe,
                PipeDirection.In,
                PipeOptions.Asynchronous
            );
            lifetime.Connect(3000);
            var lifetimeBuffer = new byte[1];
            lifetimeRead = lifetime.BeginRead(lifetimeBuffer, 0, 1, null, null);
            lifetimeWait = lifetimeRead.AsyncWaitHandle;

            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw Failure("CreateJobObjectW");

            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (!SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                ref limits,
                (uint)Marshal.SizeOf(limits)
            )) throw Failure("SetInformationJobObject");

            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeListSize);
            if (attributeListSize == IntPtr.Zero)
                throw Failure("InitializeProcThreadAttributeList size");
            attributeList = Marshal.AllocHGlobal(attributeListSize);
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeListSize))
                throw Failure("InitializeProcThreadAttributeList");
            jobList = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobList, job);
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST,
                jobList,
                new IntPtr(IntPtr.Size),
                IntPtr.Zero,
                IntPtr.Zero
            )) throw Failure("UpdateProcThreadAttribute job list");

            var startupInfo = new STARTUPINFOEX();
            startupInfo.StartupInfo.cb = (uint)Marshal.SizeOf(startupInfo);
            startupInfo.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startupInfo.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
            startupInfo.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
            startupInfo.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
            startupInfo.lpAttributeList = attributeList;

            if (!CreateProcess(
                executable,
                CommandLine(executable, arguments),
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT,
                IntPtr.Zero,
                currentDirectory,
                ref startupInfo,
                out processInformation
            )) throw Failure("CreateProcessW");
            processCreated = true;

            if (ResumeThread(processInformation.hThread) == UInt32.MaxValue)
                throw Failure("ResumeThread");

            var waitResult = WaitForMultipleObjects(
                2,
                new[] {
                    processInformation.hProcess,
                    lifetimeWait.SafeWaitHandle.DangerousGetHandle()
                },
                false,
                INFINITE
            );
            if (waitResult == WAIT_FAILED) throw Failure("WaitForMultipleObjects");
            if (waitResult == WAIT_OBJECT_0 + 1)
            {
                try
                {
                    lifetime.EndRead(lifetimeRead);
                }
                catch (IOException)
                {
                }
                catch (ObjectDisposedException)
                {
                }
                if (!TerminateJobObject(job, 1)) throw Failure("TerminateJobObject");
                return 1;
            }
            if (waitResult != WAIT_OBJECT_0)
                throw new InvalidOperationException("WaitForMultipleObjects returned an unexpected result");

            uint exitCode;
            if (!GetExitCodeProcess(processInformation.hProcess, out exitCode))
                throw Failure("GetExitCodeProcess");
            return unchecked((int)exitCode);
        }
        catch
        {
            if (processCreated) TerminateJobObject(job, 1);
            throw;
        }
        finally
        {
            if (lifetime != null) lifetime.Dispose();
            if (lifetimeWait != null) lifetimeWait.Close();
            if (processInformation.hThread != IntPtr.Zero) CloseHandle(processInformation.hThread);
            if (processInformation.hProcess != IntPtr.Zero) CloseHandle(processInformation.hProcess);
            if (attributeList != IntPtr.Zero) DeleteProcThreadAttributeList(attributeList);
            if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
            if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }
}
'@

$decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))
$command = $decoded | ConvertFrom-Json
$arguments = @($command.args | ForEach-Object { [string] $_ })
exit [WindowsJobRunner]::Run(
    [string] $command.command,
    $arguments,
    (Get-Location).Path,
    [string] $command.lifetimePipe
)
