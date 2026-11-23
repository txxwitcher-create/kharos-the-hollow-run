import React from 'react';
import { CheckCircle2, Lock, Play, X } from 'lucide-react';
import { CAMPAIGN_LEVELS, getThemeById } from '../data/catalog';
import { SaveData } from '../types/game';
import { CoinSvg } from './Icons';

interface CampaignModalProps {
  save: SaveData;
  selectedLevelId: number;
  onSelectLevel: (levelId: number) => void;
  onLaunchLevel: (levelId: number) => void;
  onClose: () => void;
}

const DIFF_COLORS: Record<string, string> = {
  Easy: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/60',
  Normal: 'text-sky-300 border-sky-500/40 bg-sky-950/60',
  Challenging: 'text-amber-300 border-amber-500/40 bg-amber-950/60',
  Hard: 'text-orange-300 border-orange-500/40 bg-orange-950/60',
  'Very Hard': 'text-rose-300 border-rose-500/40 bg-rose-950/60',
  Extreme: 'text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-950/60',
  'Final Challenge': 'text-yellow-200 border-yellow-400/60 bg-yellow-950/70',
};

export const CampaignModal: React.FC<CampaignModalProps> = ({
  save,
  selectedLevelId,
  onSelectLevel,
  onLaunchLevel,
  onClose,
}) => {
  const theme = getThemeById(save.selectedTheme);
  const completedTotal = Object.values(save.levelRecords).filter((r) => r.completed).length;

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#0b0e14]/96 p-4">
      <div className="flex items-center justify-between pb-3 border-b border-stone-800">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">
            Campaign Expedition · {completedTotal}/20 Cleared
          </p>
          <h2 className="font-display font-extrabold text-xl text-stone-100">20 HANDCRAFTED REALMS</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 flex items-center justify-center"
          aria-label="Close Campaign Map"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <p className="text-[11px] text-stone-400 mt-2 mb-2.5">
        No checkpoints — complete each realm in one run to unlock the next environment.
      </p>

      <div className="flex-1 overflow-y-auto kharos-scroll space-y-2 pr-1">
        {CAMPAIGN_LEVELS.map((lvl) => {
          const unlocked = lvl.id <= save.highestUnlockedLevel;
          const rec = save.levelRecords[lvl.id];
          const isSelected = lvl.id === selectedLevelId;

          return (
            <div
              key={lvl.id}
              className={`rounded-xl border p-3 transition-colors ${
                !unlocked
                  ? 'bg-stone-950/70 border-stone-800/80 opacity-65'
                  : isSelected
                    ? 'bg-stone-900/95'
                    : 'bg-stone-900/70 border-stone-800 hover:border-stone-600'
              }`}
              style={isSelected && unlocked ? { borderColor: theme.uiAccent } : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  disabled={!unlocked}
                  onClick={() => onSelectLevel(lvl.id)}
                  className="text-left flex-1 min-w-0 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="w-6 h-6 rounded-md text-xs font-extrabold flex items-center justify-center tabular-nums"
                      style={{
                        backgroundColor: unlocked ? lvl.palette.archAccent : '#27272a',
                        color: unlocked ? '#111318' : '#71717a',
                      }}
                    >
                      {lvl.id}
                    </span>
                    <span className="font-display font-bold text-sm text-stone-100 truncate">
                      {lvl.name}
                    </span>
                    {rec?.completed && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                    {!unlocked && <Lock className="w-3.5 h-3.5 text-stone-500 shrink-0" />}
                  </div>
                  <p className="text-[11px] text-stone-400 mt-1 line-clamp-1">{lvl.subtitle}</p>
                </button>

                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 ${
                    DIFF_COLORS[lvl.difficulty] ?? 'text-stone-300 border-stone-700'
                  }`}
                >
                  {lvl.difficulty}
                </span>
              </div>

              <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-stone-800/80 text-[11px]">
                <div className="flex items-center gap-3 text-stone-300 tabular-nums">
                  <span>{lvl.targetDistance}m</span>
                  <span className="flex items-center gap-1 text-amber-300 font-semibold">
                    <CoinSvg color={theme.coinColor} className="w-3.5 h-3.5" />
                    +{lvl.completionBonus.toLocaleString()}
                  </span>
                  {rec && rec.bestDistance > 0 && (
                    <span className="text-stone-400">Best: {rec.bestDistance}m</span>
                  )}
                </div>

                {unlocked ? (
                  <button
                    type="button"
                    onClick={() => onLaunchLevel(lvl.id)}
                    className="px-3 py-1 rounded-lg font-bold text-[11px] text-stone-950 flex items-center gap-1 cursor-pointer"
                    style={{ backgroundColor: theme.uiAccent }}
                  >
                    <Play className="w-3 h-3 fill-stone-950" />
                    {rec?.completed ? 'Replay' : 'Play'}
                  </button>
                ) : (
                  <span className="text-[10px] font-semibold text-stone-500">
                    Clear Lv.{lvl.id - 1}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
