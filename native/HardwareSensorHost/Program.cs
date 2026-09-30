using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using LibreHardwareMonitor.Hardware;

namespace TurtleMonitor.HardwareSensorHost
{
    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer
        {
            MaxJsonLength = 16 * 1024 * 1024,
            RecursionLimit = 100
        };

        private static int Main(string[] args)
        {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            TextWriter responseWriter = Console.Out;

            try
            {
                string pipeName = ReadArgument(args, "--pipe");
                if (!string.IsNullOrWhiteSpace(pipeName))
                {
                    ValidatePipeName(pipeName);
                    string clientSid = ReadArgument(args, "--client-sid");
                    using (NamedPipeServerStream pipe = new NamedPipeServerStream(
                        pipeName,
                        PipeDirection.InOut,
                        1,
                        PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous,
                        4096,
                        4096,
                        CreatePipeSecurity(clientSid)))
                    {
                        IAsyncResult connection = pipe.BeginWaitForConnection(null, null);
                        if (!connection.AsyncWaitHandle.WaitOne(TimeSpan.FromSeconds(20)))
                            throw new TimeoutException("Hardware sensor pipe connection timed out");
                        pipe.EndWaitForConnection(connection);
                        using (StreamReader reader = new StreamReader(
                            pipe, new UTF8Encoding(false), false, 4096, true))
                        using (StreamWriter writer = new StreamWriter(
                            pipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true })
                        {
                            responseWriter = writer;
                            RunComputerSession(reader, writer, false);
                        }
                    }
                    return 0;
                }

                bool once = args.Any(argument => string.Equals(
                    argument, "--once", StringComparison.OrdinalIgnoreCase));
                RunComputerSession(Console.In, Console.Out, once);
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error);
                try
                {
                    responseWriter.WriteLine(Json.Serialize(new
                    {
                        type = "fatal",
                        error = error.Message,
                        elevated = IsElevated()
                    }));
                }
                catch
                {
                    // The original exception on stderr is the useful fallback.
                }
                return 1;
            }
        }

        private static void RunComputerSession(TextReader reader, TextWriter writer, bool once)
        {
            Computer computer = CreateComputer();
            try
            {
                computer.Open();
                if (once)
                    WriteSnapshot(computer, writer);
                else
                    RunCommandLoop(computer, reader, writer);
            }
            finally
            {
                computer.Close();
            }
        }

        private static void RunCommandLoop(Computer computer, TextReader reader, TextWriter writer)
        {
            writer.WriteLine(Json.Serialize(new
            {
                type = "ready",
                protocolVersion = 1,
                elevated = IsElevated()
            }));
            writer.Flush();

            string command;
            while ((command = reader.ReadLine()) != null)
            {
                command = command.Trim();
                if (string.Equals(command, "quit", StringComparison.OrdinalIgnoreCase))
                    break;
                if (string.Equals(command, "snapshot", StringComparison.OrdinalIgnoreCase))
                    WriteSnapshot(computer, writer);
            }
        }

        private static string ReadArgument(IEnumerable<string> args, string name)
        {
            string prefix = name + "=";
            string[] values = args.ToArray();
            for (int index = 0; index < values.Length; index += 1)
            {
                string value = values[index] ?? string.Empty;
                if (value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    return value.Substring(prefix.Length);
                if (string.Equals(value, name, StringComparison.OrdinalIgnoreCase) && index + 1 < values.Length)
                    return values[index + 1];
            }
            return null;
        }

        private static void ValidatePipeName(string pipeName)
        {
            if (pipeName.Length > 160 || pipeName.IndexOfAny(new[] { '\\', '/' }) >= 0)
                throw new ArgumentException("Invalid hardware sensor pipe name");
        }

        private static PipeSecurity CreatePipeSecurity(string clientSid)
        {
            PipeSecurity security = new PipeSecurity();
            SecurityIdentifier client = string.IsNullOrWhiteSpace(clientSid)
                ? new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null)
                : new SecurityIdentifier(clientSid);
            PipeAccessRights clientRights = PipeAccessRights.ReadWrite | PipeAccessRights.CreateNewInstance;
            security.AddAccessRule(new PipeAccessRule(client, clientRights, AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
                PipeAccessRights.FullControl,
                AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
                PipeAccessRights.FullControl,
                AccessControlType.Allow));
            return security;
        }

        private static Computer CreateComputer()
        {
            return new Computer
            {
                IsBatteryEnabled = true,
                IsControllerEnabled = true,
                IsCpuEnabled = true,
                IsGpuEnabled = true,
                IsMemoryEnabled = true,
                IsMotherboardEnabled = true,
                IsNetworkEnabled = true,
                IsPowerMonitorEnabled = true,
                IsPsuEnabled = true,
                IsStorageEnabled = true
            };
        }

        private static void WriteSnapshot(Computer computer, TextWriter writer)
        {
            List<object> sensors = new List<object>();
            List<object> hardware = new List<object>();
            List<string> errors = new List<string>();

            foreach (IHardware device in computer.Hardware)
                CollectHardware(device, sensors, hardware, errors, null);

            writer.WriteLine(Json.Serialize(new
            {
                type = "snapshot",
                protocolVersion = 1,
                provider = "librehardwaremonitor",
                providerVersion = typeof(Computer).Assembly.GetName().Version.ToString(),
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                elevated = IsElevated(),
                hardware,
                sensors,
                errors
            }));
            writer.Flush();
        }

        private static void CollectHardware(
            IHardware device,
            ICollection<object> sensors,
            ICollection<object> hardware,
            ICollection<string> errors,
            string parentIdentifier)
        {
            try
            {
                device.Update();
            }
            catch (Exception error)
            {
                errors.Add(device.Identifier + ": " + error.Message);
            }

            string identifier = device.Identifier == null ? string.Empty : device.Identifier.ToString();
            hardware.Add(new
            {
                identifier,
                parentIdentifier,
                name = device.Name,
                hardwareType = device.HardwareType.ToString()
            });

            foreach (ISensor sensor in device.Sensors)
            {
                double? value = Normalize(sensor.Value);
                double? minimum = Normalize(sensor.Min);
                double? maximum = Normalize(sensor.Max);
                sensors.Add(new
                {
                    identifier = sensor.Identifier == null ? string.Empty : sensor.Identifier.ToString(),
                    name = sensor.Name,
                    sensorType = sensor.SensorType.ToString(),
                    index = sensor.Index,
                    value,
                    min = minimum,
                    max = maximum,
                    hardwareIdentifier = identifier,
                    hardwareName = device.Name,
                    hardwareType = device.HardwareType.ToString()
                });
            }

            foreach (IHardware child in device.SubHardware)
                CollectHardware(child, sensors, hardware, errors, identifier);
        }

        private static double? Normalize(float? value)
        {
            if (!value.HasValue || float.IsNaN(value.Value) || float.IsInfinity(value.Value))
                return null;
            return Math.Round(value.Value, 4);
        }

        private static bool IsElevated()
        {
            try
            {
                WindowsIdentity identity = WindowsIdentity.GetCurrent();
                WindowsPrincipal principal = new WindowsPrincipal(identity);
                return principal.IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch
            {
                return false;
            }
        }
    }
}
