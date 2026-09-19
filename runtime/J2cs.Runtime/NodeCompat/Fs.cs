namespace J2cs.Runtime.NodeCompat;

public static class NodeFs
{
    public static NodeFsReadResult ReadFileSync(string path, NodeFsReadFileOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(path);
        options ??= NodeFsReadFileOptions.BufferDefault;
        try
        {
            if (Directory.Exists(path))
                throw new NodeFsException("EISDIR", "read", path, "illegal operation on a directory");
            using var stream = OpenReadStream(path, options.Flag, asynchronous: false);
            using var memory = new MemoryStream();
            stream.CopyTo(memory);
            return DecodeReadResult(memory.ToArray(), options.Encoding);
        }
        catch (NodeFsException)
        {
            throw;
        }
        catch (NodeFsArgumentException)
        {
            throw;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            throw Wrap(ex, "open", path);
        }
    }

    public static JsValue WriteFileSync(string path, string data, NodeFsWriteFileOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(data);
        options ??= NodeFsWriteFileOptions.Default;
        return WriteFileSyncCore(path, NodeFsEncodingCodec.Encode(data, options.Encoding), options);
    }

    public static JsValue WriteFileSync(string path, NodeFsBuffer data, NodeFsWriteFileOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(data);
        options ??= NodeFsWriteFileOptions.Default;
        return WriteFileSyncCore(path, data.Span, options);
    }

    public static bool ExistsSync(string path)
    {
        if (path is null) return false;
        try
        {
            return EntryExists(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return false;
        }
    }

    private static JsValue WriteFileSyncCore(string path, ReadOnlySpan<byte> bytes, NodeFsWriteFileOptions options)
    {
        ArgumentNullException.ThrowIfNull(path);
        var exclusive = IsExclusiveWriteFlag(options.Flag);
        try
        {
            using var stream = OpenWriteStream(path, options.Flag, asynchronous: false);
            stream.Write(bytes);
            if (options.Flush) stream.Flush(flushToDisk: true);
            return JsUndefined.Value;
        }
        catch (NodeFsArgumentException)
        {
            throw;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            throw Wrap(ex, "open", path, exclusive);
        }
    }

    internal static NodeFsReadResult DecodeReadResult(byte[] bytes, NodeFsTextEncoding? encoding)
        => encoding is null
            ? NodeFsReadResult.FromBuffer(bytes)
            : NodeFsReadResult.FromString(NodeFsEncodingCodec.Decode(bytes, encoding.Value));

    internal static FileStream OpenReadStream(string path, string flag, bool asynchronous)
    {
        var access = flag switch
        {
            "r" or "rs" => FileAccess.Read,
            "r+" or "rs+" => FileAccess.ReadWrite,
            _ => throw InvalidFlag(flag),
        };
        return new FileStream(path, FileMode.Open, access, FileShare.ReadWrite | FileShare.Delete, 4096,
            asynchronous ? FileOptions.Asynchronous : FileOptions.None);
    }

    internal static FileStream OpenWriteStream(string path, string flag, bool asynchronous)
    {
        var mode = flag switch
        {
            "w" or "w+" => FileMode.Create,
            "wx" or "xw" or "wx+" or "xw+" => FileMode.CreateNew,
            "a" or "a+" => FileMode.Append,
            "ax" or "xa" or "ax+" or "xa+" => FileMode.CreateNew,
            _ => throw InvalidFlag(flag),
        };
        return new FileStream(path, mode, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete, 4096,
            asynchronous ? FileOptions.Asynchronous : FileOptions.None);
    }

    internal static bool IsExclusiveWriteFlag(string flag)
        => flag is "wx" or "xw" or "wx+" or "xw+" or "ax" or "xa" or "ax+" or "xa+";

    internal static bool EntryExists(string path) => File.Exists(path) || Directory.Exists(path);

    internal static NodeFsException Wrap(Exception exception, string syscall, string path, bool exclusive = false)
    {
        if (exception is NodeFsException node) return node;
        var code = exception switch
        {
            FileNotFoundException or DirectoryNotFoundException => "ENOENT",
            PathTooLongException => "ENAMETOOLONG",
            UnauthorizedAccessException => "EACCES",
            IOException when exclusive && EntryExists(path) => "EEXIST",
            IOException => "EIO",
            _ => "EINVAL",
        };
        return new NodeFsException(code, syscall, path, exception.Message, exception);
    }

    private static NodeFsArgumentException InvalidFlag(string flag)
        => new("ERR_INVALID_ARG_VALUE", $"Unsupported Node fs flag in the bounded compatibility profile: {flag}", nameof(flag));
}
