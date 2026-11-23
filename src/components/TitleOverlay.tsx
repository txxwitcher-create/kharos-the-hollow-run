import React from 'react';
import {
  Compass,
  Crown,
  Flame,
  Palette,
  Settings,
  ShoppingBag,
  Trophy,
  Users,
} from 'lucide-react';
import { getCharacterById, getLevelById, getThemeById } from '../data/catalog';
import { PlayMode, SaveData } from '../types/game';
import { CoinSvg, KharosTitleLockup, SoundSvg } from './Icons';

export type ActiveDrawer =
  | null
  | 'campaign'
  | 'characters'
  | 'themes'
  | 'missions'
  | 'settings';

interface TitleOverlayProps {
  save: SaveData;
  selectedLevelId: number;
  selectedMode: PlayMode;
  unclaimedRewardsCount: number;
  onModeChange: (mode: PlayMode) => void;
  onStartPlay: () => void;
  onOpenDrawer: (drawer: ActiveDrawer) => void;
  onToggleMute: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  save,
  selectedLevelId,
  selectedMode,
  unclaimedRewardsCount,
  onModeChange,
  onStartPlay,
  onOpenDrawer,
  onToggleMute,
}) => {
  const level = getLevelById(selectedLevelId);
  const char = getCharacterById(save.selectedCharacter);
  const theme = getThemeById(save.selectedTheme);

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-between pointer-events-none px-4 pt-3 pb-3">
      {/* Top Bar: Coin Balance & Utility Buttons */}
      <div className="flex items-center justify-between gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={() => onOpenDrawer('themes')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-stone-100 shadow-lg active:scale-95 transition-transform"
          style={{
            backgroundColor: theme.uiSurface,
            borderColor: theme.uiBorder,
          }}
          aria-label={`Coins balance: ${save.coins.toLocaleString()}. Open shop`}
        >
          <CoinSvg color={theme.coinColor} className="w-5 h-5 shrink-0" />
          <span className="font-bold text-sm tabular-nums tracking-tight">
            {save.coins.toLocaleString()}
          </span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMute}
            className="w-9 h-9 rounded-lg border flex items-center justify-center text-stone-200 hover:text-white active:scale-95 transition-transform"
            style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiBorder }}
            aria-label={save.settings.audio.muted ? 'Unmute audio' : 'Mute audio'}
          >
            <SoundSvg muted={save.settings.audio.muted} className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onOpenDrawer('missions')}
            className="relative w-9 h-9 rounded-lg border flex items-center justify-center text-stone-200 hover:text-white active:scale-95 transition-transform"
            style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiBorder }}
            aria-label="Daily Missions and Achievements"
          >
            <Trophy className="w-4 h-4" />
            {unclaimedRewardsCount > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-extrabold text-stone-950 flex items-center justify-center tabular-nums"
                style={{ backgroundColor: theme.uiAccent }}
              >
                {unclaimedRewardsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onOpenDrawer('settings')}
            className="w-9 h-9 rounded-lg border flex items-center justify-center text-stone-200 hover:text-white active:scale-95 transition-transform"
            style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiBorder }}
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Upper Calm Sky Negative Space: Bespoke Title Lockup */}
      <div className="flex flex-col items-center mt-1">
        <KharosTitleLockup accentColor={theme.uiAccent} />
      </div>

      {/* Central viewport left unobstructed so the live 3D Explorer & world vista shine! */}
      <div className="flex-1" />

      {/* Bottom Action Block */}
      <div className="flex flex-col gap-2.5 pointer-events-auto">
        {/* Selected Mode + Current Expedition Summary Strip */}
        <div
          className="flex items-center justify-between px-3 py-2 rounded-xl border"
          style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiBorder }}
        >
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-stone-400">
              {selectedMode === 'campaign'
                ? `Level ${level.id} · ${level.difficulty}`
                : selectedMode === 'endless'
                  ? `Endless · Best ${save.bestEndlessDistance.toLocaleString()}m`
                  : 'Interactive Training'}
            </div>
            <div className="text-sm font-display font-bold text-stone-100 truncate">
              {selectedMode === 'tutorial' ? 'Sanctuary Basics' : level.name}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onModeChange('campaign')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-colors ${
                selectedMode === 'campaign'
                  ? 'text-stone-950'
                  : 'text-stone-300 bg-stone-800/80 hover:bg-stone-700'
              }`}
              style={selectedMode === 'campaign' ? { backgroundColor: theme.uiAccent } : undefined}
            >
              Campaign
            </button>
            <button
              type="button"
              onClick={() => onModeChange('endless')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-colors ${
                selectedMode === 'endless'
                  ? 'text-stone-950'
                  : 'text-stone-300 bg-stone-800/80 hover:bg-stone-700'
              }`}
              style={selectedMode === 'endless' ? { backgroundColor: theme.uiAccent } : undefined}
            >
              Endless
            </button>
          </div>
        </div>

        {/* Primary Play CTA */}
        <button
          type="button"
          data-start="true"
          onClick={onStartPlay}
          className="w-full py-3.5 rounded-xl font-display font-extrabold text-lg tracking-[0.16em] text-stone-950 shadow-[0_8px_24px_rgba(0,0,0,0.55)] active:scale-[0.98] transition-transform flex items-center justify-center gap-2.5 cursor-pointer"
          style={{ backgroundColor: theme.uiAccent }}
        >
          <Flame className="w-5 h-5 fill-stone-950" />
          <span>
            {selectedMode === 'campaign'
              ? `PLAY LEVEL ${level.id}`
              : selectedMode === 'endless'
                ? 'RUN ENDLESS'
                : 'START TUTORIAL'}
          </span>
        </button>

        {/* Unified Bottom Navigation Dock */}
        <nav
          aria-label="Game menus"
          className="grid grid-cols-4 gap-1.5 p-1.5 rounded-xl border"
          style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiBorder }}
        >
          <button
            type="button"
            onClick={() => onOpenDrawer('campaign')}
            className="flex flex-col items-center justify-center py-1.5 rounded-lg text-stone-200 hover:bg-white/10 transition-colors"
          >
            <Compass className="w-4 h-4 mb-0.5" style={{ color: theme.uiAccent }} />
            <span className="text-[10px] font-bold tracking-wide">Levels</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenDrawer('characters')}
            className="flex flex-col items-center justify-center py-1.5 rounded-lg text-stone-200 hover:bg-white/10 transition-colors"
          >
            <Users className="w-4 h-4 mb-0.5" style={{ color: theme.uiAccent }} />
            <span className="text-[10px] font-bold tracking-wide">{char.name.split(' ')[0]}</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenDrawer('themes')}
            className="flex flex-col items-center justify-center py-1.5 rounded-lg text-stone-200 hover:bg-white/10 transition-colors"
          >
            <Palette className="w-4 h-4 mb-0.5" style={{ color: theme.uiAccent }} />
            <span className="text-[10px] font-bold tracking-wide">Themes</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenDrawer('missions')}
            className="flex flex-col items-center justify-center py-1.5 rounded-lg text-stone-200 hover:bg-white/10 transition-colors relative"
          >
            {unclaimedRewardsCount > 0 ? (
              <Crown className="w-4 h-4 mb-0.5" style={{ color: theme.uiAccent }} />
            ) : (
              <ShoppingBag className="w-4 h-4 mb-0.5" style={{ color: theme.uiAccent }} />
            )}
            <span className="text-[10px] font-bold tracking-wide">Quests</span>
          </button>
        </nav>

        {/* Single flat borderless control-hint line in bottom safe margin */}
        <p className="text-center text-[10px] font-semibold text-stone-100 bg-black/55 rounded-md py-1 px-2 whitespace-nowrap tracking-tight">
          Swipe/WASD Move · Space Jump · S Slide · E Ability · Esc Pause
        </p>
      </div>
    </div>
  );
};
