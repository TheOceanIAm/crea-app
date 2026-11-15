import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cropImageBase64 } from "@/lib/cropImageBase64";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef<CropView | null>(null);
  const naturalRef = useRef(natural);
  const frameRef = useRef({ width: 1, height: 1 });
  const grantRef = useRef<{ view: CropView; dist: number; count: number; originDx: number; originDy: number } | null>(null);

  useEffect(() => {
    setBusy(false);
    setError(null);
    setView(null);
    setNatural(request && request.width > 0 && request.height > 0 ? { w: request.width, h: request.height } : null);
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
  naturalRef.current = natural;
  viewRef.current = view;

  useEffect(() => {
    if (!natural) return;
    const next = initialCropView(natural.w, natural.h, frame.width, frame.height);
    viewRef.current = next;
    setView(next);
  }, [natural, frame.width, frame.height]);

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

  const scale =
    natural && view ? Math.max(frame.width / natural.w, frame.height / natural.h) * view.zoom : 0;

  if (!request) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onDone({ ok: false, cancelled: true })}>
      <View style={[styles.backdrop, { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Text style={styles.title}>Choose the crop</Text>
        <Text style={styles.hint}>Drag to move the photo. Pinch or use + and − to zoom.</Text>
        <View
          style={[
            styles.frame,
            request?.shape === "circle" ? styles.circle : styles.rect,
            { width: frame.width, height: frame.height },
          ]}
          {...dragResponder.panHandlers}
        >
          <Image
              source={{ uri: request.uri }}
              onLoad={(event) => {
                const width = event.nativeEvent.source?.width;
                const height = event.nativeEvent.source?.height;
                if (width > 0 && height > 0) {
                  setNatural((current) =>
                    current && current.w === width && current.h === height ? current : { w: width, h: height }
                  );
                }
              }}
              resizeMode="contain"
              style={
                natural && view
                  ? {
                      position: "absolute",
                      width: natural.w * scale,
                      height: natural.h * scale,
                      left: view.tx,
                      top: view.ty,
                    }
                  : styles.hiddenImage
              }
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
    overflow: "hidden",
    backgroundColor: "#000",
    borderWidth: 2,
    borderColor: "#FFDC00",
  },
  circle: { borderRadius: 999 },
  rect: { borderRadius: 16 },
  hiddenImage: { width: 1, height: 1, opacity: 0 },
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
