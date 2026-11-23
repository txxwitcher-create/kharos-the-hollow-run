import React from 'react';
import { getCharacterById, getLevelById, getThemeById } from '../data/catalog';
import { LiveHudSnapshot, PlayMode, SaveData } from '../types/game';
import { AbilitySvg, CoinSvg, PauseSvg, SoundSvg } from './Icons';

interface GameHudProps {
  hud: LiveHudSnapshot;
  save: SaveData;
  mode: PlayMode;
  levelId: number;
  onPause: () => void;
  onToggleMute: () => void;
  onActivateAbility: () => void;
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  save,
  mode,
  levelId,
  onPause,
  onToggleMute,
  onActivateAbility,
}) => {
  const char = getCharacterById(save.selectedCharacter);
  const level = getLevelById(levelId);
  const theme = getThemeById(save.selectedTheme);
  const progressPct =
    hud.targetDistance > 0 ? Math.min(100, Math.round((hud.distance / hud.targetDistance) * 100)) : 0;

  return (
    <div className="absolute inset-0 z-20 pointer-events-none flex flex-col justify-between p-3.5">
      {/* Subtle Peripheral Vignette ONLY when The Hollow draws near */}
      {hud.hollowThreat > 0.32 && (
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-200"
          style={{
            opacity: Math.min(0.75, (hud.hollowThreat - 0.3) * 1.1),
            boxShadow: 'inset 0 0 70px 18px rgba(153, 27, 27, 0.72)',
          }}
        />
      )}

      {/* Top Perimeter Clusters (>= 85% playfield completely unobstructed) */}
      <div className="relative flex items-start justify-between gap-2">
        {/* Top-Left: Distance, Level Progress Bar & Coins */}
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className="font-display font-extrabold text-2xl text-stone-50 tabular-nums hud-text-stroke leading-none">
              {hud.distance}m
            </span>
            {hud.targetDistance > 0 && (
              <span className="text-[11px] font-bold uppercase tracking-wider text-stone-200 hud-text-shadow tabular-nums">
                / {hud.targetDistance}m
              </span>
            )}
          </div>

          {hud.targetDistance > 0 && (
            <div className="w-32 h-1.5 rounded-full bg-stone-950/80 overflow-hidden border border-stone-600/50">
              <div
                className="h-full transition-all duration-150"
                style={{ width: `${progressPct}%`, backgroundColor: theme.uiAccent }}
              />
            </div>
          )}

          <div className="flex items-center gap-1.5 mt-0.5">
            <CoinSvg color={theme.coinColor} className="w-4 h-4 shrink-0" />
            <span className="font-bold text-sm text-amber-200 tabular-nums hud-text-shadow">
              {hud.coins}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-300/90 hud-text-shadow ml-1">
              {mode === 'campaign' ? level.name : mode === 'tutorial' ? 'Tutorial' : 'Endless'}
            </span>
          </div>
        </div>

        {/* Top-Right: Compact Mute & Pause Controls */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            className="w-9 h-9 rounded-lg border flex items-center justify-center text-stone-100 active:scale-95 transition-transform"
            style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiBorder }}
            aria-label={save.settings.audio.muted ? 'Unmute audio' : 'Mute audio'}
          >
            <SoundSvg muted={save.settings.audio.muted} className="w-4 h-4" />
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            className="w-9 h-9 rounded-lg border flex items-center justify-center text-stone-100 active:scale-95 transition-transform"
            style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiBorder }}
            aria-label="Pause game"
          >
            <PauseSvg className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Transient Non-Blocking Contextual Cues in upper band (central playfield 100% unobstructed) */}
      <div className="flex flex-col items-center gap-1.5 mt-3 mb-auto pointer-events-none">
        {hud.turnPrompt && (
          <div
            className="px-3.5 py-1 rounded-lg border font-display font-extrabold text-xs tracking-[0.18em] text-stone-950 shadow-lg"
            style={{ backgroundColor: theme.uiAccent, borderColor: '#ffffff' }}
          >
            {hud.turnPrompt === 'FORK3'
              ? '◀ LEFT · CENTER · RIGHT ▶'
              : hud.turnPrompt === 'FORK'
                ? '◀ SWIPE LEFT OR RIGHT ▶'
                : hud.turnPrompt === 'LEFT'
                  ? '◀ TURN LEFT NOW'
                  : 'TURN RIGHT NOW ▶'}
          </div>
        )}

        {hud.activeRouteLabel && !hud.turnPrompt && (
          <div
            className="px-2.5 py-0.5 rounded-md border text-[10px] font-extrabold tracking-[0.2em] uppercase text-amber-200 shadow"
            style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiBorder }}
          >
            {hud.activeRouteLabel}
          </div>
        )}

        {hud.nearMissBanner &&
          hud.nearMissBanner !== hud.activeRouteLabel &&
          save.settings.gameplay.visualFeedback && (
          <div className="px-3 py-1 rounded-md bg-stone-950/88 border border-amber-400/65 text-amber-200 font-bold text-[11px] tracking-widest uppercase">
            {hud.nearMissBanner}
          </div>
        )}
      </div>

      {/* Bottom Perimeter: Tutorial Hint + Ability Activation Ring */}
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-1.5 max-w-[68%]">
          {hud.tutorialHint && (
            <div
              className="px-3 py-2 rounded-lg border text-stone-100 text-xs font-medium leading-snug shadow-lg"
              style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiAccent }}
            >
              {hud.tutorialHint}
            </div>
          )}
        </div>

        {/* Bottom-Right: Character Ability Trigger Button */}
        <button
          type="button"
          tabIndex={-1}
          disabled={!hud.abilityReady}
          onClick={(e) => {
            e.currentTarget.blur();
            onActivateAbility();
          }}
          className={`pointer-events-auto relative w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center transition-transform ${
            hud.abilityReady
              ? 'active:scale-90 cursor-pointer shadow-[0_0_18px_rgba(250,204,21,0.45)]'
              : 'opacity-75 cursor-default'
          }`}
          style={{
            backgroundColor: hud.abilityActiveRatio > 0 ? 'rgba(234,179,8,0.28)' : theme.uiSurface,
            borderColor: hud.abilityReady || hud.abilityActiveRatio > 0 ? theme.uiAccent : 'rgba(148,163,184,0.35)',
          }}
          aria-label={`Activate ${char.abilityName} (${hud.abilityReady ? 'Ready' : `${hud.abilityCharge}%`})`}
        >
          <AbilitySvg abilityId={char.abilityId} className="w-6 h-6" />
          <span className="text-[9px] font-extrabold uppercase tracking-wider text-stone-100 tabular-nums mt-0.5">
            {hud.abilityActiveRatio > 0
              ? 'ON'
              : hud.abilityReady
                ? 'E'
                : `${hud.abilityCharge}%`}
          </span>
        </button>
      </div>
    </div>
  );
};
