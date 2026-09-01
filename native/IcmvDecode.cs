// CID EchoTrace Local -- private ICMV Audio Codec bridge.
//
// The supplied ICMV codec is an x86 ACM (.acm) module. This x86 helper loads
// it for this process only with acmDriverAdd; it neither runs the MSI nor
// writes to Drivers32, System32, or any other system registry location.

using System;
using System.IO;
using System.Runtime.InteropServices;

internal static class IcmvDecode
{
    private const int ExitSuccess = 0;
    private const int ExitUsage = 2;
    private const int ExitInvalidWave = 3;
    // Node treats this as "not ICMV, try FFmpeg normally".
    private const int ExitUnsupportedSourceFormat = 4;
    private const int ExitCodecFailure = 5;
    private const int ExitIoFailure = 6;

    // acmDriverAdd driver-type value. An app-added driver is private to that
    // application; locality defaults to ACM_DRIVERADDF_LOCAL (zero).
    private const uint AcmDriverAddFunction = 0x00000003;
    private const uint AcmStreamSizeSource = 0;
    private const uint AcmStreamConvertBlockAlign = 0x00000004;
    private const uint AcmStreamConvertStart = 0x00000010;
    private const uint AcmStreamConvertEnd = 0x00000020;
    private const int WaveFormatPcm = 1;
    private const int ChunkSize = 1024 * 1024;

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct WaveFormatEx
    {
        public ushort FormatTag;
        public ushort Channels;
        public uint SamplesPerSecond;
        public uint AverageBytesPerSecond;
        public ushort BlockAlign;
        public ushort BitsPerSample;
        public ushort ExtraSize;
    }

    // Layout is deliberately x86. This project is compiled /platform:x86,
    // matching the supplied icmv.acm PE architecture.
    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct AcmStreamHeader
    {
        public uint StructureSize;
        public uint Status;
        public IntPtr User;
        public IntPtr Source;
        public uint SourceLength;
        public uint SourceLengthUsed;
        public IntPtr SourceUser;
        public IntPtr Destination;
        public uint DestinationLength;
        public uint DestinationLengthUsed;
        public IntPtr DestinationUser;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 10)]
        public IntPtr[] DriverReserved;
    }

    private sealed class WaveSource
    {
        public byte[] Format;
        public long DataOffset;
        public uint DataLength;
        public WaveFormatEx SourceFormat;
    }

    private static class NativeMethods
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern IntPtr LoadLibrary(string fileName);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr GetProcAddress(IntPtr module, string procedureName);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool FreeLibrary(IntPtr module);

        [DllImport("msacm32.dll")]
        internal static extern int acmDriverAdd(out IntPtr driverId, IntPtr module, IntPtr driverProcedure, uint priority, uint flags);

        [DllImport("msacm32.dll")]
        internal static extern int acmDriverRemove(IntPtr driverId, uint flags);

        [DllImport("msacm32.dll")]
        internal static extern int acmDriverOpen(out IntPtr driver, IntPtr driverId, uint flags);

        [DllImport("msacm32.dll")]
        internal static extern int acmDriverClose(IntPtr driver, uint flags);

        [DllImport("msacm32.dll")]
        internal static extern int acmStreamOpen(out IntPtr stream, IntPtr driver, IntPtr sourceFormat, IntPtr destinationFormat, IntPtr filter, IntPtr callback, IntPtr instance, uint flags);

        [DllImport("msacm32.dll")]
        internal static extern int acmStreamClose(IntPtr stream, uint flags);

        [DllImport("msacm32.dll")]
        internal static extern int acmStreamSize(IntPtr stream, uint inputBytes, out uint outputBytes, uint flags);

        [DllImport("msacm32.dll")]
        internal static extern int acmStreamPrepareHeader(IntPtr stream, ref AcmStreamHeader header, uint flags);

        [DllImport("msacm32.dll")]
        internal static extern int acmStreamUnprepareHeader(IntPtr stream, ref AcmStreamHeader header, uint flags);

        [DllImport("msacm32.dll")]
        internal static extern int acmStreamConvert(IntPtr stream, ref AcmStreamHeader header, uint flags);
    }

    private static int Main(string[] arguments)
    {
        try
        {
            if (arguments.Length == 2 && string.Equals(arguments[0], "--probe", StringComparison.OrdinalIgnoreCase))
            {
                Probe(arguments[1]);
                Console.WriteLine("ICMV ACM codec is available for this process.");
                return ExitSuccess;
            }

            if (arguments.Length != 3)
            {
                Console.Error.WriteLine("Usage: icmv-decode-x86.exe <icmv.acm> <input.wav> <output.wav>");
                Console.Error.WriteLine("       icmv-decode-x86.exe --probe <icmv.acm>");
                return ExitUsage;
            }

            Decode(arguments[0], arguments[1], arguments[2]);
            return ExitSuccess;
        }
        catch (UnsupportedSourceFormatException error)
        {
            Console.Error.WriteLine(error.Message);
            return ExitUnsupportedSourceFormat;
        }
        catch (InvalidDataException error)
        {
            Console.Error.WriteLine(error.Message);
            return ExitInvalidWave;
        }
        catch (IOException error)
        {
            Console.Error.WriteLine(error.Message);
            return ExitIoFailure;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return ExitCodecFailure;
        }
    }

    private static void Probe(string codecPath)
    {
        IntPtr module = IntPtr.Zero;
        IntPtr driverId = IntPtr.Zero;
        IntPtr driver = IntPtr.Zero;
        try
        {
            OpenPrivateDriver(codecPath, out module, out driverId, out driver);
        }
        finally
        {
            ClosePrivateDriver(module, driverId, driver);
        }
    }

    private static void Decode(string codecPath, string inputPath, string outputPath)
    {
        WaveSource wave = ReadWaveSource(inputPath);
        if (wave.SourceFormat.FormatTag == WaveFormatPcm)
        {
            throw new UnsupportedSourceFormatException("Input WAV is already PCM; use the standard media decoder.");
        }

        IntPtr module = IntPtr.Zero;
        IntPtr driverId = IntPtr.Zero;
        IntPtr driver = IntPtr.Zero;
        IntPtr stream = IntPtr.Zero;
        IntPtr sourceFormat = IntPtr.Zero;
        IntPtr destinationFormat = IntPtr.Zero;
        try
        {
            OpenPrivateDriver(codecPath, out module, out driverId, out driver);
            WaveFormatEx destination = CreatePcmFormat(wave.SourceFormat);
            sourceFormat = AllocateFormat(wave.Format);
            destinationFormat = AllocateFormat(StructureBytes(destination));
            int openResult = NativeMethods.acmStreamOpen(out stream, driver, sourceFormat, destinationFormat, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0);
            if (openResult != 0)
            {
                throw new UnsupportedSourceFormatException("The private ICMV codec does not support this WAV source format (ACM result " + openResult + ").");
            }

            DecodeToPcm(inputPath, outputPath, wave, destination, stream);
        }
        finally
        {
            if (stream != IntPtr.Zero) NativeMethods.acmStreamClose(stream, 0);
            if (destinationFormat != IntPtr.Zero) Marshal.FreeHGlobal(destinationFormat);
            if (sourceFormat != IntPtr.Zero) Marshal.FreeHGlobal(sourceFormat);
            ClosePrivateDriver(module, driverId, driver);
        }
    }

    private static void OpenPrivateDriver(string codecPath, out IntPtr module, out IntPtr driverId, out IntPtr driver)
    {
        if (!File.Exists(codecPath)) throw new FileNotFoundException("The bundled ICMV codec file was not found.", codecPath);
        module = NativeMethods.LoadLibrary(Path.GetFullPath(codecPath));
        driverId = IntPtr.Zero;
        driver = IntPtr.Zero;
        if (module == IntPtr.Zero) throw new InvalidOperationException("Windows could not load the x86 ICMV ACM module (Win32 error " + Marshal.GetLastWin32Error() + ").");
        IntPtr procedure = NativeMethods.GetProcAddress(module, "DriverProc");
        if (procedure == IntPtr.Zero) throw new InvalidOperationException("The ICMV ACM module does not export DriverProc.");
        int addResult = NativeMethods.acmDriverAdd(out driverId, module, procedure, 0, AcmDriverAddFunction);
        if (addResult != 0) throw new InvalidOperationException("ACM could not add the ICMV decoder privately (result " + addResult + ").");
        int openResult = NativeMethods.acmDriverOpen(out driver, driverId, 0);
        if (openResult != 0) throw new InvalidOperationException("ACM could not open the private ICMV decoder (result " + openResult + ").");
    }

    private static void ClosePrivateDriver(IntPtr module, IntPtr driverId, IntPtr driver)
    {
        if (driver != IntPtr.Zero) NativeMethods.acmDriverClose(driver, 0);
        if (driverId != IntPtr.Zero) NativeMethods.acmDriverRemove(driverId, 0);
        if (module != IntPtr.Zero) NativeMethods.FreeLibrary(module);
    }

    private static WaveSource ReadWaveSource(string inputPath)
    {
        using (FileStream input = new FileStream(inputPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (BinaryReader reader = new BinaryReader(input))
        {
            if (input.Length < 20 || ReadFourCc(reader) != "RIFF") throw new InvalidDataException("Input is not a RIFF/WAV file.");
            reader.ReadUInt32();
            if (ReadFourCc(reader) != "WAVE") throw new InvalidDataException("Input is not a WAVE file.");

            byte[] format = null;
            long dataOffset = 0;
            uint dataLength = 0;
            while (input.Position + 8 <= input.Length)
            {
                string chunkId = ReadFourCc(reader);
                uint chunkLength = reader.ReadUInt32();
                long chunkStart = input.Position;
                if (chunkLength > input.Length - chunkStart) throw new InvalidDataException("WAV chunk length exceeds the input file.");
                if (chunkId == "fmt ")
                {
                    if (chunkLength < 16 || chunkLength > 65536) throw new InvalidDataException("The WAV format chunk is invalid.");
                    format = reader.ReadBytes((int)chunkLength);
                    if (format.Length != chunkLength) throw new EndOfStreamException("WAV format chunk ended unexpectedly.");
                }
                else if (chunkId == "data" && dataLength == 0)
                {
                    dataOffset = chunkStart;
                    dataLength = chunkLength;
                    input.Position += chunkLength;
                }
                else
                {
                    input.Position += chunkLength;
                }
                if ((chunkLength & 1) != 0 && input.Position < input.Length) input.Position++;
                if (format != null && dataLength > 0) break;
            }

            if (format == null || dataLength == 0) throw new InvalidDataException("The WAV file is missing a usable fmt or data chunk.");
            WaveFormatEx sourceFormat = ReadFormat(format);
            if (sourceFormat.Channels == 0 || sourceFormat.SamplesPerSecond == 0 || sourceFormat.BlockAlign == 0)
            {
                throw new InvalidDataException("The WAV source format contains invalid channel, sample-rate, or block-size values.");
            }
            return new WaveSource { Format = format, DataOffset = dataOffset, DataLength = dataLength, SourceFormat = sourceFormat };
        }
    }

    private static void DecodeToPcm(string inputPath, string outputPath, WaveSource wave, WaveFormatEx destinationFormat, IntPtr stream)
    {
        string directory = Path.GetDirectoryName(Path.GetFullPath(outputPath));
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        long pcmBytes = 0;
        using (FileStream input = new FileStream(inputPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (FileStream output = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            WriteWaveHeader(output, destinationFormat, 0);
            input.Position = wave.DataOffset;
            uint remaining = wave.DataLength;
            byte[] inputBuffer = new byte[Math.Max(wave.SourceFormat.BlockAlign, ChunkSize - (ChunkSize % wave.SourceFormat.BlockAlign))];
            bool first = true;
            while (remaining > 0)
            {
                int wanted = (int)Math.Min((uint)inputBuffer.Length, remaining);
                wanted -= wanted % wave.SourceFormat.BlockAlign;
                if (wanted == 0) throw new InvalidDataException("The final compressed audio block is incomplete.");
                ReadExactly(input, inputBuffer, wanted);
                remaining -= (uint)wanted;
                int offset = 0;
                while (offset < wanted)
                {
                    int sourceLength = wanted - offset;
                    uint destinationCapacity;
                    int sizeResult = NativeMethods.acmStreamSize(stream, (uint)sourceLength, out destinationCapacity, AcmStreamSizeSource);
                    if (sizeResult != 0 || destinationCapacity == 0) throw new InvalidOperationException("ACM could not calculate ICMV output size (result " + sizeResult + ").");
                    destinationCapacity = checked(destinationCapacity + 65536);
                    IntPtr sourceBuffer = IntPtr.Zero;
                    IntPtr destinationBuffer = IntPtr.Zero;
                    try
                    {
                        sourceBuffer = Marshal.AllocHGlobal(sourceLength);
                        Marshal.Copy(inputBuffer, offset, sourceBuffer, sourceLength);
                        destinationBuffer = Marshal.AllocHGlobal((int)destinationCapacity);
                        AcmStreamHeader header = new AcmStreamHeader();
                        header.StructureSize = (uint)Marshal.SizeOf(typeof(AcmStreamHeader));
                        header.Source = sourceBuffer;
                        header.SourceLength = (uint)sourceLength;
                        header.Destination = destinationBuffer;
                        header.DestinationLength = destinationCapacity;
                        header.DriverReserved = new IntPtr[10];
                        int prepareResult = NativeMethods.acmStreamPrepareHeader(stream, ref header, 0);
                        if (prepareResult != 0) throw new InvalidOperationException("ACM could not prepare an ICMV conversion buffer (result " + prepareResult + ").");
                        try
                        {
                            uint convertFlags = AcmStreamConvertBlockAlign;
                            if (first) convertFlags |= AcmStreamConvertStart;
                            if (remaining == 0) convertFlags |= AcmStreamConvertEnd;
                            int convertResult = NativeMethods.acmStreamConvert(stream, ref header, convertFlags);
                            if (convertResult != 0) throw new InvalidOperationException("ACM could not decode ICMV audio (result " + convertResult + ").");
                            if (header.SourceLengthUsed == 0) throw new InvalidOperationException("The ICMV decoder did not consume any source data.");
                            if (header.SourceLengthUsed > header.SourceLength || header.DestinationLengthUsed > header.DestinationLength) throw new InvalidOperationException("The ICMV decoder reported an invalid buffer length.");
                            if (header.DestinationLengthUsed > 0)
                            {
                                byte[] pcm = new byte[header.DestinationLengthUsed];
                                Marshal.Copy(destinationBuffer, pcm, 0, pcm.Length);
                                if (pcmBytes + pcm.Length > UInt32.MaxValue) throw new IOException("Decoded PCM is too large for a standard WAV output.");
                                output.Write(pcm, 0, pcm.Length);
                                pcmBytes += pcm.Length;
                            }
                            offset += (int)header.SourceLengthUsed;
                            first = false;
                        }
                        finally
                        {
                            NativeMethods.acmStreamUnprepareHeader(stream, ref header, 0);
                        }
                    }
                    finally
                    {
                        if (destinationBuffer != IntPtr.Zero) Marshal.FreeHGlobal(destinationBuffer);
                        if (sourceBuffer != IntPtr.Zero) Marshal.FreeHGlobal(sourceBuffer);
                    }
                }
            }
            output.Position = 0;
            WriteWaveHeader(output, destinationFormat, (uint)pcmBytes);
        }
    }

    private static WaveFormatEx CreatePcmFormat(WaveFormatEx source)
    {
        ushort blockAlign = checked((ushort)(source.Channels * 2));
        return new WaveFormatEx {
            FormatTag = WaveFormatPcm,
            Channels = source.Channels,
            SamplesPerSecond = source.SamplesPerSecond,
            AverageBytesPerSecond = checked(source.SamplesPerSecond * blockAlign),
            BlockAlign = blockAlign,
            BitsPerSample = 16,
            ExtraSize = 0
        };
    }

    private static WaveFormatEx ReadFormat(byte[] format)
    {
        if (format.Length < 16) throw new InvalidDataException("The WAV format chunk is too short.");
        using (BinaryReader reader = new BinaryReader(new MemoryStream(format, false)))
        {
            WaveFormatEx result = new WaveFormatEx();
            result.FormatTag = reader.ReadUInt16();
            result.Channels = reader.ReadUInt16();
            result.SamplesPerSecond = reader.ReadUInt32();
            result.AverageBytesPerSecond = reader.ReadUInt32();
            result.BlockAlign = reader.ReadUInt16();
            result.BitsPerSample = reader.ReadUInt16();
            result.ExtraSize = format.Length >= 18 ? reader.ReadUInt16() : (ushort)0;
            return result;
        }
    }

    private static byte[] StructureBytes(WaveFormatEx format)
    {
        byte[] result = new byte[18];
        using (BinaryWriter writer = new BinaryWriter(new MemoryStream(result)))
        {
            writer.Write(format.FormatTag);
            writer.Write(format.Channels);
            writer.Write(format.SamplesPerSecond);
            writer.Write(format.AverageBytesPerSecond);
            writer.Write(format.BlockAlign);
            writer.Write(format.BitsPerSample);
            writer.Write(format.ExtraSize);
        }
        return result;
    }

    private static IntPtr AllocateFormat(byte[] format)
    {
        IntPtr result = Marshal.AllocHGlobal(format.Length);
        Marshal.Copy(format, 0, result, format.Length);
        return result;
    }

    private static void WriteWaveHeader(Stream output, WaveFormatEx format, uint dataLength)
    {
        using (BinaryWriter writer = new BinaryWriter(output, System.Text.Encoding.ASCII, true))
        {
            writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
            writer.Write(checked(36 + dataLength));
            writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt "));
            writer.Write((uint)16);
            writer.Write(format.FormatTag);
            writer.Write(format.Channels);
            writer.Write(format.SamplesPerSecond);
            writer.Write(format.AverageBytesPerSecond);
            writer.Write(format.BlockAlign);
            writer.Write(format.BitsPerSample);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("data"));
            writer.Write(dataLength);
        }
    }

    private static string ReadFourCc(BinaryReader reader)
    {
        byte[] bytes = reader.ReadBytes(4);
        if (bytes.Length != 4) throw new EndOfStreamException("WAV header ended unexpectedly.");
        return System.Text.Encoding.ASCII.GetString(bytes);
    }

    private static void ReadExactly(Stream stream, byte[] buffer, int count)
    {
        int offset = 0;
        while (offset < count)
        {
            int read = stream.Read(buffer, offset, count - offset);
            if (read == 0) throw new EndOfStreamException("WAV audio data ended unexpectedly.");
            offset += read;
        }
    }

    private sealed class UnsupportedSourceFormatException : Exception
    {
        internal UnsupportedSourceFormatException(string message) : base(message) { }
    }
}
