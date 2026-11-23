import React, { useState } from 'react';
import { Award, CheckCircle2, Home, Play, RotateCcw, Settings, ShieldAlert } from 'lucide-react';
import { getLevelById, getThemeById } from '../data/catalog';
import { LevelRewardBreakdown, RunStats, SaveData } from '../types/game';
import { CoinSvg } from './Icons';

interface PauseModalProps {
  save: SaveData;
  levelId: number;
  onResume: () => void;
  onRestart: () => void;
  onOpenSettings: () => void;
  onMainMenu: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  save,
  levelId,
  onResume,
  onRestart,
  onOpenSettings,
  onMainMenu,
}) => {
  const [confirmAction, setConfirmAction] = useState<'restart' | 'menu' | null>(null);
  const theme = getThemeById(save.selectedTheme);
  const level = getLevelById(levelId);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-5 bg-black/72">
      <div
        className="w-full max-w-[330px] rounded-2xl border p-5 shadow-2xl flex flex-col gap-3"
        style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiBorder }}
        role="dialog"
        aria-modal="true"
        aria-label="Game Paused"
      >
        <div className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-stone-400">
            Expedition Halted
          </p>
          <h2 className="font-display font-extrabold text-2xl text-stone-100 mt-0.5">PAUSED</h2>
          <p className="text-xs text-stone-400 mt-0.5">{level.name}</p>
        </div>

        {confirmAction ? (
          <div className="rounded-xl bg-stone-900/90 border border-amber-500/40 p-3.5 text-center space-y-3">
            <p className="text-xs text-stone-200 font-medium">
              {confirmAction === 'restart'
                ? 'Restart this run from 0m? Current run progress will reset.'
                : 'Return to Main Menu? Current run progress will be lost.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="py-2 rounded-lg bg-stone-800 text-stone-200 text-xs font-bold hover:bg-stone-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAction === 'restart' ? onRestart : onMainMenu}
                className="py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-500"
              >
                Confirm
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-1">
            <button
              type="button"
              onClick={onResume}
              className="w-full py-3 rounded-xl font-display font-bold text-sm tracking-wider text-stone-950 flex items-center justify-center gap-2 cursor-pointer"
              style={{ backgroundColor: theme.uiAccent }}
            >
              <Play className="w-4 h-4 fill-stone-950" />
              RESUME RUN
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction('restart')}
              className="w-full py-2.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-100 text-xs font-bold tracking-wider flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              RESTART LEVEL
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="w-full py-2.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-100 text-xs font-bold tracking-wider flex items-center justify-center gap-2"
            >
              <Settings className="w-4 h-4" />
              SETTINGS
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction('menu')}
              className="w-full py-2.5 rounded-xl bg-stone-900/90 hover:bg-stone-800 border border-stone-700 text-stone-300 text-xs font-bold tracking-wider flex items-center justify-center gap-2"
            >
              <Home className="w-4 h-4" />
              MAIN MENU
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

interface GameOverModalProps {
  save: SaveData;
  stats: RunStats;
  onRetry: () => void;
  onMainMenu: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  save,
  stats,
  onRetry,
  onMainMenu,
}) => {
  const theme = getThemeById(save.selectedTheme);
  const level = getLevelById(stats.levelId);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/78">
      <div
        className="w-full max-w-[345px] rounded-2xl border p-5 shadow-2xl flex flex-col gap-3.5"
        style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiBorder }}
        role="dialog"
        aria-modal="true"
        aria-label="Run Ended"
      >
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 text-red-400 text-[11px] font-bold uppercase tracking-[0.2em]">
            <ShieldAlert className="w-4 h-4" />
            <span>{stats.causeOfDeath ?? 'Expedition Fallen'}</span>
          </div>
          <h2 className="font-display font-extrabold text-2xl text-stone-100 mt-1">RUN ENDED</h2>
          <p className="text-xs text-stone-400">{level.name}</p>
          {stats.isNewRecord && (
            <div
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold text-stone-950"
              style={{ backgroundColor: theme.uiAccent }}
            >
              <Award className="w-3.5 h-3.5" />
              NEW BEST DISTANCE!
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Distance" value={`${stats.distance.toLocaleString()}m`} accent />
          <StatTile label="Best Distance" value={`${stats.bestDistance.toLocaleString()}m`} />
          <StatTile label="Coins Collected" value={`+${stats.coinsCollected}`} />
          <StatTile label="Obstacles Avoided" value={`${stats.obstaclesAvoided}`} />
          <StatTile label="Near-Misses" value={`${stats.nearMisses}`} />
          <StatTile label="Duration" value={`${stats.durationSec}s`} />
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            data-start="true"
            onClick={onRetry}
            className="w-full py-3 rounded-xl font-display font-extrabold text-sm tracking-[0.14em] text-stone-950 flex items-center justify-center gap-2 cursor-pointer"
            style={{ backgroundColor: theme.uiAccent }}
          >
            <RotateCcw className="w-4 h-4" />
            RETRY
          </button>
          <button
            type="button"
            onClick={onMainMenu}
            className="w-full py-2.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-200 text-xs font-bold tracking-wider flex items-center justify-center gap-2"
          >
            <Home className="w-4 h-4" />
            MAIN MENU
          </button>
        </div>
      </div>
    </div>
  );
};

interface VictoryModalProps {
  save: SaveData;
  stats: RunStats;
  rewards: LevelRewardBreakdown | null;
  onNextLevel: () => void;
  onReplay: () => void;
  onMainMenu: () => void;
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  save,
  stats,
  rewards,
  onNextLevel,
  onReplay,
  onMainMenu,
}) => {
  const theme = getThemeById(save.selectedTheme);
  const level = getLevelById(stats.levelId);
  const hasNext = stats.mode === 'campaign' && stats.levelId < 20;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/78">
      <div
        className="w-full max-w-[350px] rounded-2xl border p-5 shadow-2xl flex flex-col gap-3.5"
        style={{ backgroundColor: theme.uiSurface, borderColor: theme.uiAccent }}
        role="dialog"
        aria-modal="true"
        aria-label="Level Completed"
      >
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 text-emerald-400 text-[11px] font-bold uppercase tracking-[0.22em]">
            <CheckCircle2 className="w-4 h-4" />
            <span>{stats.mode === 'tutorial' ? 'Training Complete' : `Level ${level.id} Cleared`}</span>
          </div>
          <h2 className="font-display font-extrabold text-2xl text-amber-100 mt-1">
            LEVEL COMPLETED
          </h2>
          <p className="text-xs text-stone-300 mt-0.5">{level.name}</p>
        </div>

        {rewards ? (
          <div className="rounded-xl bg-stone-950/75 border border-stone-700/70 p-3 space-y-1.5 text-xs">
            <RewardRow label="Run Coins Collected" value={rewards.runCoins} />
            <RewardRow label="Completion Bonus" value={rewards.completionBonus} />
            {rewards.firstTimeBonus > 0 && (
              <RewardRow label="First-Time Clear Bonus" value={rewards.firstTimeBonus} highlight />
            )}
            {rewards.perfectRunBonus > 0 && (
              <RewardRow label="Perfect Run Bonus" value={rewards.perfectRunBonus} highlight />
            )}
            {rewards.challengeBonus > 0 && (
              <RewardRow label="Relic Challenge Bonus" value={rewards.challengeBonus} highlight />
            )}
            <div className="border-t border-stone-700 pt-2 mt-1 flex items-center justify-between font-bold text-sm">
              <span className="text-stone-200">Total Coins Earned</span>
              <span className="flex items-center gap-1.5 text-amber-300 tabular-nums">
                <CoinSvg color={theme.coinColor} className="w-4 h-4" />
                +{rewards.totalEarned.toLocaleString()}
              </span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Distance" value={`${stats.distance}m`} accent />
            <StatTile label="Coins Earned" value={`+${stats.coinsCollected + 400}`} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          {hasNext && (
            <button
              type="button"
              data-start="true"
              onClick={onNextLevel}
              className="w-full py-3 rounded-xl font-display font-extrabold text-sm tracking-[0.14em] text-stone-950 flex items-center justify-center gap-2 cursor-pointer"
              style={{ backgroundColor: theme.uiAccent }}
            >
              <Play className="w-4 h-4 fill-stone-950" />
              NEXT LEVEL ({stats.levelId + 1})
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-start={!hasNext ? 'true' : undefined}
              onClick={onReplay}
              className="py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-100 text-xs font-bold tracking-wider"
            >
              REPLAY
            </button>
            <button
              type="button"
              onClick={onMainMenu}
              className="py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-700 text-stone-200 text-xs font-bold tracking-wider"
            >
              MAIN MENU
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const LoadingOverlay: React.FC<{ levelId: number; themeId: string }> = ({
  levelId,
  themeId,
}) => {
  const level = getLevelById(levelId);
  const theme = getThemeById(themeId);
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center p-6 bg-[#0a0d12]">
      <p className="text-[11px] font-bold uppercase tracking-[0.26em]" style={{ color: theme.uiAccent }}>
        Entering Realm {level.id} / 20
      </p>
      <h2 className="font-display font-extrabold text-2xl text-stone-100 mt-1 text-center">
        {level.name}
      </h2>
      <p className="text-xs text-stone-400 text-center max-w-[280px] mt-2 leading-relaxed">
        {level.storySnippet}
      </p>
      <div className="w-48 h-1.5 rounded-full bg-stone-800 mt-5 overflow-hidden">
        <div
          className="h-full w-3/4 rounded-full transition-all duration-300"
          style={{ backgroundColor: theme.uiAccent }}
        />
      </div>
    </div>
  );
};

const StatTile: React.FC<{ label: string; value: string; accent?: boolean }> = ({
  label,
  value,
  accent,
}) => (
  <div className="rounded-xl bg-stone-950/75 border border-stone-800 px-3 py-2">
    <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</div>
    <div
      className={`text-base font-extrabold tabular-nums mt-0.5 ${
        accent ? 'text-amber-300' : 'text-stone-100'
      }`}
    >
      {value}
    </div>
  </div>
);

const RewardRow: React.FC<{ label: string; value: number; highlight?: boolean }> = ({
  label,
  value,
  highlight,
}) => (
  <div className="flex items-center justify-between">
    <span className={highlight ? 'text-emerald-300 font-semibold' : 'text-stone-300'}>{label}</span>
    <span className="font-bold tabular-nums text-amber-200">+{value.toLocaleString()}</span>
  </div>
);
