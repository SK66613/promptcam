import 'dart:async';
import 'dart:math' as math;

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:gal/gal.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  List<CameraDescription> cameras = const [];
  try {
    cameras = await availableCameras();
  } on CameraException catch (error) {
    debugPrint('Camera discovery error: ${error.code} ${error.description}');
  }

  runApp(PromptCamApp(cameras: cameras));
}

class PromptCamApp extends StatelessWidget {
  const PromptCamApp({super.key, required this.cameras});

  final List<CameraDescription> cameras;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'PromptCam',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.deepPurple,
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF0B0B0F),
      ),
      home: ScriptEditorScreen(cameras: cameras),
    );
  }
}

class ScriptEditorScreen extends StatefulWidget {
  const ScriptEditorScreen({super.key, required this.cameras});

  final List<CameraDescription> cameras;

  @override
  State<ScriptEditorScreen> createState() => _ScriptEditorScreenState();
}

class _ScriptEditorScreenState extends State<ScriptEditorScreen> {
  final TextEditingController _scriptController = TextEditingController(
    text: '''Всем привет!\n\nСегодня я хочу показать вам PromptCam — простой суфлёр прямо поверх камеры.\n\nТекст двигается автоматически, а видео записывается без текста суфлёра.\n\nМожно менять скорость прокрутки и размер шрифта, ставить текст на паузу и переключать камеру.\n\nГотово. Поехали!''',
  );

  double _speed = 42;
  double _fontSize = 32;

  @override
  void dispose() {
    _scriptController.dispose();
    super.dispose();
  }

  void _openCamera() {
    final script = _scriptController.text.trim();
    if (script.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Сначала вставь текст для суфлёра.')),
      );
      return;
    }

    if (widget.cameras.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Камера не найдена. Запускай на реальном телефоне.')),
      );
      return;
    }

    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => CameraPrompterScreen(
          cameras: widget.cameras,
          script: script,
          initialSpeed: _speed,
          initialFontSize: _fontSize,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('PromptCam'),
        centerTitle: false,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
          children: [
            Text(
              'Текст для видео',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _scriptController,
              minLines: 10,
              maxLines: 18,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(
                hintText: 'Вставь сюда сценарий...',
                filled: true,
                fillColor: Colors.white.withValues(alpha: 0.06),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(18),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: 20),
            _SettingCard(
              title: 'Скорость',
              valueText: '${_speed.round()} px/сек',
              child: Slider(
                min: 15,
                max: 110,
                divisions: 19,
                value: _speed,
                onChanged: (value) => setState(() => _speed = value),
              ),
            ),
            const SizedBox(height: 12),
            _SettingCard(
              title: 'Размер текста',
              valueText: '${_fontSize.round()} pt',
              child: Slider(
                min: 22,
                max: 54,
                divisions: 16,
                value: _fontSize,
                onChanged: (value) => setState(() => _fontSize = value),
              ),
            ),
            const SizedBox(height: 22),
            FilledButton.icon(
              onPressed: _openCamera,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(58),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18),
                ),
              ),
              icon: const Icon(Icons.videocam_rounded),
              label: const Text('Открыть камеру'),
            ),
            const SizedBox(height: 12),
            Text(
              'Суфлёр виден только тебе на экране. В записанное видео текст не попадает.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.white60,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SettingCard extends StatelessWidget {
  const _SettingCard({
    required this.title,
    required this.valueText,
    required this.child,
  });

  final String title;
  final String valueText;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
              Text(valueText, style: const TextStyle(color: Colors.white60)),
            ],
          ),
          child,
        ],
      ),
    );
  }
}

class CameraPrompterScreen extends StatefulWidget {
  const CameraPrompterScreen({
    super.key,
    required this.cameras,
    required this.script,
    required this.initialSpeed,
    required this.initialFontSize,
  });

  final List<CameraDescription> cameras;
  final String script;
  final double initialSpeed;
  final double initialFontSize;

  @override
  State<CameraPrompterScreen> createState() => _CameraPrompterScreenState();
}

class _CameraPrompterScreenState extends State<CameraPrompterScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  CameraController? _cameraController;
  CameraDescription? _selectedCamera;
  final ScrollController _scrollController = ScrollController();

  late final Ticker _ticker;
  Duration? _lastTickerElapsed;

  Timer? _recordingClock;
  Duration _recordingDuration = Duration.zero;

  bool _cameraReady = false;
  bool _isRecording = false;
  bool _promptRunning = false;
  bool _isBusy = false;
  int? _countdown;
  String? _cameraError;

  late double _speed;
  late double _fontSize;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _speed = widget.initialSpeed;
    _fontSize = widget.initialFontSize;
    _ticker = createTicker(_onTick);
    _selectedCamera = _pickInitialCamera();
    _initializeCamera();
  }

  CameraDescription _pickInitialCamera() {
    return widget.cameras.firstWhere(
      (camera) => camera.lensDirection == CameraLensDirection.front,
      orElse: () => widget.cameras.first,
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _disposeCameraOnly();
    } else if (state == AppLifecycleState.resumed && !_cameraReady) {
      _initializeCamera();
    }
  }

  Future<void> _initializeCamera() async {
    final camera = _selectedCamera;
    if (camera == null || _isBusy) return;

    _isBusy = true;
    setStateIfMounted(() {
      _cameraReady = false;
      _cameraError = null;
    });

    final oldController = _cameraController;
    _cameraController = null;
    if (oldController != null) {
      await oldController.dispose();
    }

    final controller = CameraController(
      camera,
      ResolutionPreset.high,
      enableAudio: true,
    );

    try {
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      _cameraController = controller;
      setState(() => _cameraReady = true);
    } on CameraException catch (error) {
      await controller.dispose();
      setStateIfMounted(() {
        _cameraError = _friendlyCameraError(error);
        _cameraReady = false;
      });
    } finally {
      _isBusy = false;
    }
  }

  String _friendlyCameraError(CameraException error) {
    switch (error.code) {
      case 'CameraAccessDenied':
      case 'CameraAccessDeniedWithoutPrompt':
      case 'CameraAccessRestricted':
        return 'Нет доступа к камере. Разреши камеру в настройках iPhone.';
      case 'AudioAccessDenied':
      case 'AudioAccessDeniedWithoutPrompt':
      case 'AudioAccessRestricted':
        return 'Нет доступа к микрофону. Разреши микрофон в настройках iPhone.';
      default:
        return 'Ошибка камеры: ${error.description ?? error.code}';
    }
  }

  Future<void> _disposeCameraOnly() async {
    _stopPrompt();
    _recordingClock?.cancel();
    _recordingClock = null;
    _isRecording = false;

    final controller = _cameraController;
    _cameraController = null;
    _cameraReady = false;

    if (controller != null) {
      await controller.dispose();
    }
    setStateIfMounted(() {});
  }

  void _onTick(Duration elapsed) {
    if (!_promptRunning || !_scrollController.hasClients) {
      _lastTickerElapsed = elapsed;
      return;
    }

    final previous = _lastTickerElapsed;
    _lastTickerElapsed = elapsed;
    if (previous == null) return;

    final seconds = (elapsed - previous).inMicroseconds / 1000000.0;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final nextOffset = _scrollController.offset + (_speed * seconds);

    if (nextOffset >= maxScroll) {
      _scrollController.jumpTo(maxScroll);
      _stopPrompt();
      return;
    }

    _scrollController.jumpTo(nextOffset);
  }

  void _startPrompt() {
    if (_promptRunning) return;
    _lastTickerElapsed = null;
    setStateIfMounted(() => _promptRunning = true);
    if (!_ticker.isActive) _ticker.start();
  }

  void _stopPrompt() {
    if (!_promptRunning && !_ticker.isActive) return;
    if (_ticker.isActive) _ticker.stop();
    _lastTickerElapsed = null;
    setStateIfMounted(() => _promptRunning = false);
  }

  void _resetPrompt() {
    _stopPrompt();
    if (_scrollController.hasClients) {
      _scrollController.jumpTo(0);
    }
  }

  Future<void> _switchCamera() async {
    if (_isRecording || _isBusy || widget.cameras.length < 2) return;

    final current = _selectedCamera;
    if (current == null) return;

    final targetDirection = current.lensDirection == CameraLensDirection.front
        ? CameraLensDirection.back
        : CameraLensDirection.front;

    final next = widget.cameras.firstWhere(
      (camera) => camera.lensDirection == targetDirection,
      orElse: () => widget.cameras.firstWhere(
        (camera) => camera.name != current.name,
        orElse: () => current,
      ),
    );

    if (next.name == current.name) return;
    _selectedCamera = next;
    await _initializeCamera();
  }

  Future<void> _toggleRecording() async {
    final controller = _cameraController;
    if (controller == null || !_cameraReady || _isBusy) return;

    if (_isRecording) {
      await _stopRecording(controller);
    } else {
      await _startRecording(controller);
    }
  }

  Future<void> _startRecording(CameraController controller) async {
    _isBusy = true;
    try {
      _resetPrompt();

      for (var value = 3; value >= 1; value--) {
        setStateIfMounted(() => _countdown = value);
        await Future<void>.delayed(const Duration(seconds: 1));
        if (!mounted) return;
      }
      setStateIfMounted(() => _countdown = null);

      await controller.startVideoRecording();
      if (!mounted) return;

      _recordingDuration = Duration.zero;
      _recordingClock?.cancel();
      _recordingClock = Timer.periodic(const Duration(seconds: 1), (_) {
        setStateIfMounted(() {
          _recordingDuration += const Duration(seconds: 1);
        });
      });

      setState(() => _isRecording = true);
      _startPrompt();
    } on CameraException catch (error) {
      _showMessage('Не удалось начать запись: ${error.description ?? error.code}');
    } finally {
      _isBusy = false;
      setStateIfMounted(() => _countdown = null);
    }
  }

  Future<void> _stopRecording(CameraController controller) async {
    _isBusy = true;
    _recordingClock?.cancel();
    _recordingClock = null;
    _stopPrompt();

    try {
      final video = await controller.stopVideoRecording();
      setStateIfMounted(() => _isRecording = false);

      try {
        var hasAccess = await Gal.hasAccess();
        if (!hasAccess) {
          hasAccess = await Gal.requestAccess();
        }

        if (hasAccess) {
          await Gal.putVideo(video.path);
          _showMessage('Готово — видео сохранено в Фото.');
        } else {
          _showMessage('Видео записано, но доступ к Фото не разрешён.');
        }
      } on GalException catch (error) {
        _showMessage('Видео записано, но не сохранилось в Фото: ${error.type.name}');
      }
    } on CameraException catch (error) {
      _showMessage('Не удалось остановить запись: ${error.description ?? error.code}');
    } finally {
      _isBusy = false;
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  void setStateIfMounted(VoidCallback callback) {
    if (mounted) setState(callback);
  }

  String _durationLabel(Duration duration) {
    final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  Widget _buildCameraPreview() {
    final controller = _cameraController!;
    final screenSize = MediaQuery.sizeOf(context);
    final screenRatio = screenSize.width / screenSize.height;
    final cameraRatio = controller.value.aspectRatio;
    final scale = math.max(cameraRatio / screenRatio, screenRatio / cameraRatio);

    return Transform.scale(
      scale: scale,
      child: Center(child: CameraPreview(controller)),
    );
  }

  Widget _buildTeleprompter() {
    return Positioned(
      top: 64,
      left: 16,
      right: 16,
      height: MediaQuery.sizeOf(context).height * 0.36,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: Stack(
          fit: StackFit.expand,
          children: [
            ColoredBox(color: Colors.black.withValues(alpha: 0.46)),
            ListView(
              controller: _scrollController,
              padding: const EdgeInsets.fromLTRB(18, 115, 18, 160),
              physics: const NeverScrollableScrollPhysics(),
              children: [
                Text(
                  widget.script,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: _fontSize,
                    height: 1.35,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                    shadows: const [
                      Shadow(blurRadius: 6, color: Colors.black),
                    ],
                  ),
                ),
              ],
            ),
            Align(
              alignment: Alignment.center,
              child: IgnorePointer(
                child: Container(
                  height: 2,
                  margin: const EdgeInsets.symmetric(horizontal: 10),
                  color: Colors.white.withValues(alpha: 0.24),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomControls() {
    return Positioned(
      left: 12,
      right: 12,
      bottom: 14,
      child: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.68),
            borderRadius: BorderRadius.circular(24),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  const SizedBox(width: 4),
                  const Icon(Icons.speed_rounded, size: 18),
                  Expanded(
                    child: Slider(
                      min: 15,
                      max: 110,
                      value: _speed,
                      onChanged: (value) => setState(() => _speed = value),
                    ),
                  ),
                  SizedBox(
                    width: 42,
                    child: Text(
                      _speed.round().toString(),
                      textAlign: TextAlign.right,
                    ),
                  ),
                ],
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  IconButton.filledTonal(
                    onPressed: _isRecording ? null : _switchCamera,
                    icon: const Icon(Icons.cameraswitch_rounded),
                  ),
                  IconButton.filledTonal(
                    onPressed: _resetPrompt,
                    icon: const Icon(Icons.restart_alt_rounded),
                  ),
                  GestureDetector(
                    onTap: _toggleRecording,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 160),
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _isRecording ? Colors.red : Colors.white,
                        border: Border.all(
                          color: Colors.white,
                          width: _isRecording ? 4 : 3,
                        ),
                      ),
                      child: Icon(
                        _isRecording ? Icons.stop_rounded : Icons.videocam_rounded,
                        color: _isRecording ? Colors.white : Colors.red,
                        size: 34,
                      ),
                    ),
                  ),
                  IconButton.filledTonal(
                    onPressed: _promptRunning ? _stopPrompt : _startPrompt,
                    icon: Icon(
                      _promptRunning ? Icons.pause_rounded : Icons.play_arrow_rounded,
                    ),
                  ),
                  IconButton.filledTonal(
                    onPressed: () {
                      setState(() {
                        _fontSize = _fontSize >= 50 ? 24 : _fontSize + 4;
                      });
                    },
                    icon: const Icon(Icons.text_fields_rounded),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          if (_cameraReady && _cameraController != null)
            _buildCameraPreview()
          else
            Center(
              child: _cameraError == null
                  ? const CircularProgressIndicator()
                  : Padding(
                      padding: const EdgeInsets.all(28),
                      child: Text(
                        _cameraError!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 17),
                      ),
                    ),
            ),
          if (_cameraReady) _buildTeleprompter(),
          Positioned(
            top: 8,
            left: 8,
            right: 8,
            child: SafeArea(
              bottom: false,
              child: Row(
                children: [
                  IconButton.filledTonal(
                    onPressed: _isRecording ? null : () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                  const Spacer(),
                  if (_isRecording)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.58),
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.circle, color: Colors.red, size: 10),
                          const SizedBox(width: 7),
                          Text(_durationLabel(_recordingDuration)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (_cameraReady) _buildBottomControls(),
          if (_countdown != null)
            ColoredBox(
              color: Colors.black.withValues(alpha: 0.42),
              child: Center(
                child: Text(
                  '$_countdown',
                  style: const TextStyle(
                    fontSize: 110,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _recordingClock?.cancel();
    if (_ticker.isActive) _ticker.stop();
    _ticker.dispose();
    _scrollController.dispose();
    _cameraController?.dispose();
    super.dispose();
  }
}
