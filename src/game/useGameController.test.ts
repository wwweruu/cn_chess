import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPieceAt } from "./rules/xiangqiEngine";
import { useGameController } from "./useGameController";
import { playMoveSound } from '../audio/sfx';

vi.mock("../audio/sfx", () => ({ playMoveSound: vi.fn() }));

describe("game controller", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it.each(["QuotaExceededError", "SecurityError"])(
    "keeps settings usable when storage throws %s",
    (errorName) => {
      const { result } = renderHook(() => useGameController());
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("Storage unavailable", errorName);
      });

      act(() => result.current.updateSettings({ sound: false }));
      expect(result.current.settings.sound).toBe(false);

      act(() => result.current.updateSettings({ quality: "low" }));
      expect(result.current.settings).toEqual({
        sound: false,
        quality: "low",
        effects: "full",
        cameraShake: true,
      });
      act(() => result.current.clickPosition({ file: 4, rank: 6 }));
      expect(result.current.selected).toEqual({ file: 4, rank: 6 });
    },
  );

  it("keeps valid stored settings and heals invalid fields back to defaults", () => {
    localStorage.setItem(
      "xuanjia-xiangqi-settings",
      JSON.stringify({ quality: "bogus", effects: 123, sound: false, cameraShake: null, stale: true }),
    );
    const { result } = renderHook(() => useGameController());
    expect(result.current.settings).toEqual({
      quality: "auto",
      effects: "full",
      sound: false,
      cameraShake: true,
    });
  });

  it.each(['"hello"', "[1,2]", "null", "42"])(
    "falls back to default settings for a non-object record: %s",
    (raw) => {
      localStorage.setItem("xuanjia-xiangqi-settings", raw);
      const { result } = renderHook(() => useGameController());
      expect(result.current.settings).toEqual({
        quality: "auto",
        effects: "full",
        sound: true,
        cameraShake: true,
      });
    },
  );

  it("persists settings for the next controller", () => {
    const { result, unmount } = renderHook(() => useGameController());
    act(() => result.current.updateSettings({ sound: false, quality: "low" }));
    const settings = result.current.settings;
    unmount();

    const restored = renderHook(() => useGameController());
    expect(restored.result.current.settings).toEqual(settings);
  });

  it("locks input during animation and restores a move with undo", () => {
    const { result } = renderHook(() => useGameController());

    act(() => result.current.clickPosition({ file: 4, rank: 6 }));
    expect(result.current.selected).toEqual({ file: 4, rank: 6 });
    expect(result.current.legalMoves).toContainEqual({ file: 4, rank: 5 });

    act(() => result.current.clickPosition({ file: 4, rank: 5 }));
    expect(result.current.game.turn).toBe("black");
    expect(result.current.moves).toHaveLength(1);
    expect(result.current.animation).not.toBeNull();
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.clickPosition({ file: 0, rank: 3 }));
    expect(result.current.moves).toHaveLength(1);

    act(() => result.current.finishAnimation(result.current.animation!.token));
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.game.turn).toBe("red");
    expect(result.current.moves).toHaveLength(0);
    expect(getPieceAt(result.current.game, { file: 4, rank: 6 })).not.toBeNull();
    expect(getPieceAt(result.current.game, { file: 4, rank: 5 })).toBeNull();
  });

  it("clears committed and animated state when restarting", () => {
    const { result } = renderHook(() => useGameController());

    act(() => result.current.clickPosition({ file: 4, rank: 6 }));
    act(() => result.current.clickPosition({ file: 4, rank: 5 }));
    expect(result.current.moves).toHaveLength(1);

    act(() => result.current.restart());
    expect(result.current.game.turn).toBe("red");
    expect(result.current.game.pieces).toHaveLength(32);
    expect(result.current.moves).toHaveLength(0);
    expect(result.current.animation).toBeNull();
    expect(result.current.selected).toBeNull();
  });

  it('ignores stale animation callbacks after restart and plays contact once',()=>{
    const {result}=renderHook(()=>useGameController());
    const move=()=>{act(()=>result.current.clickPosition({file:4,rank:6}));act(()=>result.current.clickPosition({file:4,rank:5}));};
    move();const old=result.current.animation!.token;
    expect(playMoveSound).not.toHaveBeenCalled();
    act(()=>result.current.restart());move();const current=result.current.animation!.token;
    expect(current).toBeGreaterThan(old);
    act(()=>{result.current.finishAnimation(old);result.current.contactAnimation(old,false);});
    expect(result.current.animation?.token).toBe(current);expect(playMoveSound).not.toHaveBeenCalled();
    act(()=>{result.current.contactAnimation(current,false);result.current.contactAnimation(current,false);});
    expect(playMoveSound).toHaveBeenCalledTimes(1);
    act(()=>result.current.finishAnimation(current));expect(result.current.animation).toBeNull();
  });

  it("restores the persisted game on a fresh mount and keeps undo working", () => {
    const first = renderHook(() => useGameController());
    act(() => first.result.current.clickPosition({ file: 7, rank: 7 }));
    act(() => first.result.current.clickPosition({ file: 4, rank: 7 }));
    expect(first.result.current.moves).toHaveLength(1);
    expect(first.result.current.game.turn).toBe("black");
    first.unmount();

    const second = renderHook(() => useGameController());
    expect(second.result.current.game.turn).toBe("black");
    expect(second.result.current.moves).toHaveLength(1);
    expect(second.result.current.moves[0].piece.type).toBe("cannon");
    expect(second.result.current.canUndo).toBe(true);
    expect(second.result.current.animation).toBeNull();

    act(() => second.result.current.undo());
    expect(second.result.current.game.turn).toBe("red");
    expect(second.result.current.moves).toHaveLength(0);
  });

  it("stops persisting once the board is back to a pristine state", () => {
    const first = renderHook(() => useGameController());
    act(() => first.result.current.clickPosition({ file: 7, rank: 7 }));
    act(() => first.result.current.clickPosition({ file: 4, rank: 7 }));
    act(() => first.result.current.restart());
    first.unmount();

    const second = renderHook(() => useGameController());
    expect(second.result.current.game.pieces).toHaveLength(32);
    expect(second.result.current.moves).toHaveLength(0);
    expect(second.result.current.canUndo).toBe(false);
  });

  it("imports a valid FEN and rejects invalid input", () => {
    const { result } = renderHook(() => useGameController());
    const initialFen = result.current.game.fen;

    const imported = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/PCP1P1P1P/1C7/9/RNBAKABNR w - - 0 1";
    let accepted = false;
    act(() => {
      accepted = result.current.importFen(imported);
    });
    expect(accepted).toBe(true);
    expect(result.current.game.fen).not.toBe(initialFen);
    // Both cannons survive; one just moved so they stack on file 1.
    expect(result.current.game.pieces).toHaveLength(32);
    expect(result.current.game.pieces.filter((piece) => piece.type === "cannon" && piece.camp === "red" && piece.position.file === 1)).toHaveLength(2);
    expect(result.current.moves).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);

    const before = result.current.game.fen;
    act(() => {
      expect(result.current.importFen("not a fen")).toBe(false);
      expect(result.current.importFen("   ")).toBe(false);
    });
    expect(result.current.game.fen).toBe(before);
  });

  it("restores moves from an imported FEN and preserves that origin after undo", () => {
    const imported = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/PCP1P1P1P/1C7/9/RNBAKABNR w - - 0 1";
    const first = renderHook(() => useGameController());
    act(() => { expect(first.result.current.importFen(imported)).toBe(true); });
    const origin = first.result.current.game.fen;
    act(() => first.result.current.clickPosition({ file: 1, rank: 6 }));
    act(() => first.result.current.clickPosition({ file: 1, rank: 5 }));
    const played = first.result.current.game.fen;
    expect(first.result.current.moves).toHaveLength(1);
    first.unmount();

    const second = renderHook(() => useGameController());
    expect(second.result.current.game.fen).toBe(played);
    expect(second.result.current.moves).toHaveLength(1);
    expect(second.result.current.moves[0].disambiguation).toBe("front");
    expect(second.result.current.canUndo).toBe(true);
    act(() => second.result.current.undo());
    expect(second.result.current.game.fen).toBe(origin);
    expect(second.result.current.moves).toHaveLength(0);
    second.unmount();

    const third = renderHook(() => useGameController());
    expect(third.result.current.game.fen).toBe(origin);
    expect(third.result.current.canUndo).toBe(false);
    act(() => third.result.current.clickPosition({ file: 1, rank: 6 }));
    act(() => third.result.current.clickPosition({ file: 1, rank: 5 }));
    third.unmount();
    const fourth = renderHook(() => useGameController());
    expect(fourth.result.current.game.fen).toBe(played);
    act(() => fourth.result.current.restart());
    fourth.unmount();
    const fresh = renderHook(() => useGameController());
    expect(fresh.result.current.game.pieces).toHaveLength(32);
    expect(fresh.result.current.moves).toHaveLength(0);
    fresh.unmount();
  });
});
