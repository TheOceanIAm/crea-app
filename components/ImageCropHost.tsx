import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cropImageBase64, imagePixelSize, releaseDecodedImageCache, renderFramePreview } from "@/lib/cropImageBase64";
import { nativeBinaryHasWebView } from "@/lib/nativeWebView";
import {
  frameSizeForAspect,
  initialCropView,
  panCropView,
  zoomCropView,
  type CropView,
} from "@/lib/imageCropGeometry";
import {
  bindImageCropHost,
  settleImageCrop,
  type ImageCropRequest,
  type ImageCropResult,
} from "@/lib/imageCropSession";

export function ImageCropHost() {
  const [request, setRequest] = useState<ImageCropRequest | null>(null);

  useEffect(() => {
    return bindImageCropHost((waiter) => setRequest(waiter?.request ?? null));
  }, []);

  return (
    <ImageCropModal
      request={request}
      onDone={(result) => {
        settleImageCrop(result);
      }}
    />
  );
}

type FrameJob = {
  session: number;
  base64: string;
  view: CropView;
  frameW: number;
  frameH: number;
};

function ImageCropModal({
  request,
  onDone,
}: {
  request: ImageCropRequest | null;
  onDone: (result: ImageCropResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<CropView | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef<CropView | null>(null);
  const naturalRef = useRef(natural);
  const frameRef = useRef({ width: 1, height: 1 });
  const requestRef = useRef(request);
  const viewRequestRef = useRef<ImageCropRequest | null>(null);
  const fittedFrame = useRef({ w: 0, h: 0 });
  const grantRef = useRef<{ view: CropView; dist: number; count: number; originDx: number; originDy: number } | null>(null);
  const sessionRef = useRef(0);
  const latestJobRef = useRef<FrameJob | null>(null);
  const bakingRef = useRef(false);
  const aliveRef = useRef(true);
  const webRef = useRef<{ injectJavaScript: (script: string) => void } | null>(null);
  const webReadyRef = useRef(false);

  requestRef.current = request;
  naturalRef.current = natural;
  viewRef.current = view;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    sessionRef.current += 1;
    latestJobRef.current = null;
    setBusy(false);
    setError(null);
    setView(null);
    setNatural(null);
    setFrameUri(null);
    viewRef.current = null;
    viewRequestRef.current = null;
    fittedFrame.current = { w: 0, h: 0 };
    webReadyRef.current = false;
    return () => {
      releaseDecodedImageCache();
    };
  }, [request]);

  const { width: screenW, height: screenH } = useWindowDimensions();
  const aspect =
    request?.aspect === "source"
      ? natural
        ? natural.w / Math.max(natural.h, 1)
        : 1
      : (request?.aspect ?? 1);
  const frame = useMemo(
    () => frameSizeForAspect(aspect, screenW, Math.max(320, screenH - insets.top - insets.bottom)),
    [aspect, screenW, screenH, insets.top, insets.bottom]
  );
  frameRef.current = frame;

  useEffect(() => {
    if (!request?.base64) return;
    const session = sessionRef.current;
    const timer = setTimeout(() => {
      if (session !== sessionRef.current) return;
      try {
        const size = imagePixelSize(request.base64);
        if (session !== sessionRef.current) return;
        setNatural({ w: size.width, h: size.height });
      } catch (err) {
        if (session !== sessionRef.current) return;
        setError(err instanceof Error ? err.message : "Could not open that photo.");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [request]);

  useEffect(() => {
    if (!natural) return;
    const requestNow = requestRef.current;
    if (!requestNow) return;
    if (
      viewRef.current &&
      viewRequestRef.current === requestNow &&
      fittedFrame.current.w === frame.width &&
      fittedFrame.current.h === frame.height
    ) {
      return;
    }
    fittedFrame.current = { w: frame.width, h: frame.height };
    const next = initialCropView(natural.w, natural.h, frame.width, frame.height);
    viewRequestRef.current = requestNow;
    viewRef.current = next;
    setView(next);
  }, [natural, frame.width, frame.height]);

  const pumpRef = useRef<() => void>(() => undefined);
  pumpRef.current = () => {
    if (bakingRef.current) return;
    const job = latestJobRef.current;
    if (!job || job.session !== sessionRef.current) return;
    bakingRef.current = true;
    setTimeout(() => {
      void (async () => {
        try {
          if (job.session !== sessionRef.current || !aliveRef.current) return;
          const preview = renderFramePreview(job.base64, job.view, job.frameW, job.frameH, PixelRatio.get());
          if (job.session !== sessionRef.current || !aliveRef.current) return;
          setFrameUri(`data:image/jpeg;base64,${preview.base64}`);
        } catch (err) {
          if (job.session === sessionRef.current && aliveRef.current) {
            setError(err instanceof Error ? err.message : "Could not open that photo.");
          }
        } finally {
          bakingRef.current = false;
          const latest = latestJobRef.current;
          if (latest && latest.session === sessionRef.current && latest !== job && aliveRef.current) {
            pumpRef.current();
          }
        }
      })();
    }, 0);
  };

  useEffect(() => {
    if (!request?.base64 || !view || !natural || viewRequestRef.current !== request) return;
    latestJobRef.current = {
      session: sessionRef.current,
      base64: request.base64,
      view,
      frameW: frame.width,
      frameH: frame.height,
    };
    pumpRef.current();
  }, [request, view, natural, frame.width, frame.height]);

  useEffect(() => {
    if (!frameUri || !webReadyRef.current) return;
    webRef.current?.injectJavaScript(`window.__setCrop(${JSON.stringify(frameUri)});true;`);
  }, [frameUri]);

  const previewHtml = useMemo(
    () => cropPreviewDocument(request?.shape === "rect" ? "rect" : "circle"),
    [request?.shape]
  );

  const publish = (next: CropView) => {
    viewRef.current = next;
    setView(next);
  };

  const dragResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const current = viewRef.current;
        if (!current) return;
        const touches = event.nativeEvent.touches;
        grantRef.current = {
          view: current,
          count: touches.length,
          dist: touches.length >= 2 ? touchDistance(touches) : 0,
          originDx: 0,
          originDy: 0,
        };
      },
      onPanResponderMove: (event, gesture) => {
        const currentNatural = naturalRef.current;
        const currentFrame = frameRef.current;
        if (!currentNatural) return;
        const touches = event.nativeEvent.touches;
        const grant = grantRef.current;
        if (!grant) return;
        if (touches.length !== grant.count) {
          const current = viewRef.current;
          if (!current) return;
          grantRef.current = {
            view: current,
            count: touches.length,
            dist: touches.length >= 2 ? touchDistance(touches) : 0,
            originDx: gesture.dx,
            originDy: gesture.dy,
          };
          return;
        }
        if (touches.length >= 2 && grant.dist > 0) {
          publish(
            zoomCropView(
              grant.view,
              grant.view.zoom * (touchDistance(touches) / grant.dist),
              currentNatural.w,
              currentNatural.h,
              currentFrame.width,
              currentFrame.height
            )
          );
          return;
        }
        publish(
          panCropView(
            grant.view,
            gesture.dx - grant.originDx,
            gesture.dy - grant.originDy,
            currentNatural.w,
            currentNatural.h,
            currentFrame.width,
            currentFrame.height
          )
        );
      },
    })
  ).current;

  const zoomBy = (factor: number) => {
    if (!natural || !view) return;
    publish(zoomCropView(view, view.zoom * factor, natural.w, natural.h, frame.width, frame.height));
  };

  const confirm = () => {
    if (!request || !natural || !view || busy) return;
    setBusy(true);
    setError(null);
    const snapshot = { request, natural, view, frame };
    setTimeout(() => {
      try {
        const base64 = cropImageBase64({
          base64: snapshot.request.base64,
          width: snapshot.natural.w,
          height: snapshot.natural.h,
          view: snapshot.view,
          frameWidth: snapshot.frame.width,
          frameHeight: snapshot.frame.height,
          maxEdge: snapshot.request.maxEdge,
          maxBytes: snapshot.request.maxBytes,
        });
        onDone({ ok: true, base64 });
      } catch (err) {
        setBusy(false);
        setError(err instanceof Error ? err.message : "Could not crop that image.");
      }
    }, 40);
  };

  if (!request) return null;

  const radius = request.shape === "circle" ? Math.min(frame.width, frame.height) / 2 : 16;
  const CropWebView = loadCropWebView();
  const showPreview = (uri: string | null) => {
    if (!uri || !webReadyRef.current) return;
    webRef.current?.injectJavaScript(`window.__setCrop(${JSON.stringify(uri)});true;`);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onDone({ ok: false, cancelled: true })}>
      <View style={[styles.backdrop, { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Text style={styles.title}>Choose the crop</Text>
        <Text style={styles.hint}>Drag to move the photo. Pinch or use + and − to zoom.</Text>
        <View
          collapsable={false}
          style={[styles.frame, { width: frame.width, height: frame.height }]}
          {...dragResponder.panHandlers}
        >
          {CropWebView ? (
            <View pointerEvents="none" style={{ width: frame.width, height: frame.height, backgroundColor: "#000" }}>
              <CropWebView
                ref={webRef}
                source={{ html: previewHtml }}
                style={{ width: frame.width, height: frame.height, backgroundColor: "#000" }}
                originWhitelist={["*"]}
                javaScriptEnabled
                scrollEnabled={false}
                bounces={false}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                setSupportMultipleWindows={false}
                androidLayerType="hardware"
                onLoadEnd={() => {
                  webReadyRef.current = true;
                  showPreview(frameUri);
                }}
              />
            </View>
          ) : null}
          {frameUri ? null : (
            <View pointerEvents="none" style={[styles.spinner, { borderRadius: radius }]}>
              <ActivityIndicator color="#FFDC00" />
            </View>
          )}
          <View
            pointerEvents="none"
            style={[styles.ring, { width: frame.width, height: frame.height, borderRadius: radius }]}
          />
        </View>
        <View style={styles.zoomRow}>
          <Pressable style={styles.zoomButton} onPress={() => zoomBy(1 / 1.2)} disabled={!view || busy}>
            <Text style={styles.zoomLabel}>−</Text>
          </Pressable>
          <Text style={styles.zoomValue}>{Math.round((view?.zoom ?? 1) * 100)}%</Text>
          <Pressable style={styles.zoomButton} onPress={() => zoomBy(1.2)} disabled={!view || busy}>
            <Text style={styles.zoomLabel}>+</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Pressable style={styles.cancel} onPress={() => onDone({ ok: false, cancelled: true })} disabled={busy}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
          <Pressable style={styles.confirm} onPress={confirm} disabled={!view || busy}>
            {busy ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.confirmLabel}>Use this crop</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function cropPreviewDocument(shape: "circle" | "rect"): string {
  const radius = shape === "circle" ? "50%" : "16px";
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}img{width:100%;height:100%;object-fit:fill;display:block;background:#000;border-radius:${radius}}</style></head><body><img id="p" alt=""><script>window.__setCrop=function(src){document.getElementById("p").src=src}</script></body></html>`;
}

function loadCropWebView(): import("react").ComponentType<Record<string, unknown>> | null {
  if (!nativeBinaryHasWebView()) return null;
  try {
    return require("react-native-webview").WebView as import("react").ComponentType<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function touchDistance(touches: readonly { pageX: number; pageY: number }[]): number {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return 0;
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 14,
  },
  title: { color: "#fff", fontSize: 16, fontWeight: "700" },
  hint: { color: "rgba(255,255,255,0.45)", fontSize: 12, textAlign: "center", lineHeight: 18 },
  frame: {
    backgroundColor: "#000",
  },
  spinner: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  ring: {
    position: "absolute",
    left: 0,
    top: 0,
    borderWidth: 2,
    borderColor: "#FFDC00",
  },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomLabel: { color: "#FFDC00", fontSize: 22, fontWeight: "700" },
  zoomValue: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "700", minWidth: 52, textAlign: "center" },
  error: { color: "#f87171", fontSize: 12, textAlign: "center" },
  actions: { flexDirection: "row", gap: 12, width: "100%", maxWidth: 420 },
  cancel: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
  },
  cancelLabel: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "600" },
  confirm: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: "#FFDC00",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
  },
  confirmLabel: { color: "#0a0a0a", fontSize: 14, fontWeight: "800" },
});
