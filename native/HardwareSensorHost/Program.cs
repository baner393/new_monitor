using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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

            try
            {
                Computer computer = CreateComputer();
                try
                {
                    computer.Open();

                    if (args.Any(argument => string.Equals(argument, "--once", StringComparison.OrdinalIgnoreCase)))
                    {
                        WriteSnapshot(computer);
                        return 0;
                    }

                    Console.WriteLine(Json.Serialize(new
                    {
                        type = "ready",
                        protocolVersion = 1,
                        elevated = IsElevated()
                    }));

                    string command;
                    while ((command = Console.ReadLine()) != null)
                    {
                        command = command.Trim();
                        if (string.Equals(command, "quit", StringComparison.OrdinalIgnoreCase))
                            break;
                        if (string.Equals(command, "snapshot", StringComparison.OrdinalIgnoreCase))
                            WriteSnapshot(computer);
                    }
                }
                finally
                {
                    computer.Close();
                }
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error);
                try
                {
                    Console.WriteLine(Json.Serialize(new
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

        private static void WriteSnapshot(Computer computer)
        {
            List<object> sensors = new List<object>();
            List<object> hardware = new List<object>();
            List<string> errors = new List<string>();

            foreach (IHardware device in computer.Hardware)
                CollectHardware(device, sensors, hardware, errors, null);

            Console.WriteLine(Json.Serialize(new
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
