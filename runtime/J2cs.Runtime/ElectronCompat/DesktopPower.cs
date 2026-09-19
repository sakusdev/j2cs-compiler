namespace J2cs.Runtime.ElectronCompat;

public sealed class DesktopPowerSaveBlocker
{
    private readonly IDesktopPlatformAdapter _platform;
    private readonly Dictionary<int, DesktopPowerPolicy> _active = [];
    private int _nextId;

    internal DesktopPowerSaveBlocker(IDesktopPlatformAdapter platform) => _platform = platform;

    public int Start(string type)
    {
        DesktopRuntime.EnsureReady(_platform, "powerSaveBlocker");
        var policy = type switch
        {
            "prevent-app-suspension" => DesktopPowerPolicy.PreventAppSuspension,
            "prevent-display-sleep" => DesktopPowerPolicy.PreventDisplaySleep,
            _ => throw new ArgumentOutOfRangeException(nameof(type), type, "Unsupported Electron powerSaveBlocker type."),
        };

        lock (_active) {
            var id = checked(++_nextId);
            _active.Add(id, policy);
            ApplyEffectivePolicy();
            return id;
        }
    }

    public void Stop(int id)
    {
        lock (_active) {
            if (!_active.Remove(id)) return;
            ApplyEffectivePolicy();
        }
    }

    public bool IsStarted(int id)
    {
        lock (_active) return _active.ContainsKey(id);
    }

    public DesktopPowerPolicy EffectivePolicy
    {
        get
        {
            lock (_active) return EffectivePolicyUnsafe();
        }
    }

    private void ApplyEffectivePolicy() => _platform.SetPowerPolicy(EffectivePolicyUnsafe());

    private DesktopPowerPolicy EffectivePolicyUnsafe()
    {
        if (_active.ContainsValue(DesktopPowerPolicy.PreventDisplaySleep)) return DesktopPowerPolicy.PreventDisplaySleep;
        if (_active.ContainsValue(DesktopPowerPolicy.PreventAppSuspension)) return DesktopPowerPolicy.PreventAppSuspension;
        return DesktopPowerPolicy.None;
    }
}

public sealed class DesktopPowerMonitor
{
    private readonly IDesktopPlatformAdapter _platform;

    internal DesktopPowerMonitor(IDesktopPlatformAdapter platform) => _platform = platform;

    public bool IsOnBatteryPower() => _platform.IsOnBatteryPower();

    public int GetSystemIdleTime()
    {
        var seconds = _platform.GetSystemIdleTimeSeconds();
        if (seconds < 0) throw new InvalidOperationException("Host returned a negative system idle time.");
        return seconds;
    }

    public DesktopIdleState GetSystemIdleState(int idleThresholdSeconds)
    {
        if (idleThresholdSeconds < 0) throw new ArgumentOutOfRangeException(nameof(idleThresholdSeconds));
        return _platform.GetSystemIdleState(idleThresholdSeconds);
    }
}
