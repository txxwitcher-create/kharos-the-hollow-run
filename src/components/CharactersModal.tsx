import React, { useEffect, useState } from 'react';
import { Check, Lock, Sparkles, X } from 'lucide-react';
import {
  CHARACTERS,
  getOutfitById,
  getOutfitsForCharacter,
  getThemeById,
} from '../data/catalog';
import {
  getAbilityCooldownSec,
  getAbilityDurationSec,
  getAbilityUpgradeCost,
} from '../game/rules';
import { CharacterId, SaveData } from '../types/game';
import { CharacterPreview3D } from './CharacterPreview3D';
import { AbilitySvg, CoinSvg } from './Icons';

interface CharactersModalProps {
  save: SaveData;
  onSelectCharacter: (id: CharacterId) => void;
  onUnlockCharacter: (id: CharacterId) => void;
  onEquipOrBuyOutfit: (outfitId: string) => void;
  onUpgradeAbility: (abilityId: 'magnet' | 'rush' | 'shield' | 'double_jump') => void;
  onClose: () => void;
}

const RARITY_STYLES: Record<string, string> = {
  Default: 'text-stone-300 border-stone-600',
  Basic: 'text-emerald-300 border-emerald-500/50',
  Rare: 'text-sky-300 border-sky-500/50',
  Epic: 'text-purple-300 border-purple-500/50',
  Legendary: 'text-amber-300 border-amber-400/70',
};

export const CharactersModal: React.FC<CharactersModalProps> = ({
  save,
  onSelectCharacter,
  onUnlockCharacter,
  onEquipOrBuyOutfit,
  onUpgradeAbility,
  onClose,
}) => {
  const [viewingCharId, setViewingCharId] = useState<CharacterId>(save.selectedCharacter);
  const [previewOutfitId, setPreviewOutfitId] = useState<string>(
    save.equippedOutfits[save.selectedCharacter],
  );
  const [tab, setTab] = useState<'overview' | 'outfits' | 'ability'>('overview');
  const theme = getThemeById(save.selectedTheme);

  const char = CHARACTERS.find((c) => c.id === viewingCharId) ?? CHARACTERS[0];
  const isUnlocked = save.unlockedCharacters.includes(char.id);
  const isSelected = save.selectedCharacter === char.id;
  const outfits = getOutfitsForCharacter(char.id);
  const equippedOutfitId = save.equippedOutfits[char.id];
  const previewOutfit = getOutfitById(previewOutfitId);
  const activePreviewOutfit =
    previewOutfit.characterId === char.id ? previewOutfit : getOutfitById(equippedOutfitId);
  const abilityLevel = save.abilityLevels[char.abilityId] ?? 1;
  const upgradeCost = getAbilityUpgradeCost(abilityLevel);

  useEffect(() => {
    setPreviewOutfitId(save.equippedOutfits[viewingCharId]);
  }, [viewingCharId, save.equippedOutfits]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#0b0e14]/96 p-4">
      <div className="flex items-center justify-between pb-3 border-b border-stone-800">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">
            Explorers, Outfits & Abilities
          </p>
          <h2 className="font-display font-extrabold text-xl text-stone-100">EXPEDITION ROSTER</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-700 text-xs font-bold tabular-nums text-amber-200">
            <CoinSvg color={theme.coinColor} className="w-4 h-4" />
            {save.coins.toLocaleString()}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 flex items-center justify-center"
            aria-label="Close Roster"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 4 Playable Characters Selector Strip */}
      <div className="grid grid-cols-4 gap-1.5 mt-3">
        {CHARACTERS.map((c) => {
          const unlocked = save.unlockedCharacters.includes(c.id);
          const active = c.id === viewingCharId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setViewingCharId(c.id);
                setPreviewOutfitId(save.equippedOutfits[c.id]);
                if (unlocked) onSelectCharacter(c.id);
              }}
              className={`rounded-xl border p-2 text-center transition-colors ${
                active ? 'bg-stone-800 text-white' : 'bg-stone-950/70 border-stone-800 text-stone-400'
              }`}
              style={active ? { borderColor: theme.uiAccent } : undefined}
            >
              <div className="text-xs font-bold truncate">{c.name.split(' ')[0]}</div>
              <div className="text-[10px] text-stone-400 mt-0.5">
                {c.age}y · {c.gender === 'male' ? 'M' : 'F'}
              </div>
              {!unlocked && <Lock className="w-3 h-3 mx-auto mt-1 text-amber-400/80" />}
            </button>
          );
        })}
      </div>

      {/* Live 3D Interactive Explorer & Outfit Stage */}
      <CharacterPreview3D
        character={char}
        outfit={activePreviewOutfit}
        accentColor={theme.uiAccent}
      />

      {/* Sub-Tabs */}
      <div className="grid grid-cols-3 gap-1.5 mt-2.5 bg-stone-950/80 p-1 rounded-xl border border-stone-800">
        {(['overview', 'outfits', 'ability'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${
              tab === t ? 'text-stone-950' : 'text-stone-300 hover:text-white'
            }`}
            style={tab === t ? { backgroundColor: theme.uiAccent } : undefined}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto kharos-scroll mt-3 pr-1">
        {tab === 'overview' && (
          <div className="space-y-3">
            <div className="rounded-xl bg-stone-900/85 border border-stone-800 p-4 space-y-2.5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-display font-bold text-lg text-stone-100">{char.name}</h3>
                  <p className="text-xs font-semibold text-amber-300">
                    {char.title} · Age {char.age}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-stone-950 border border-stone-700 flex items-center justify-center">
                  <AbilitySvg abilityId={char.abilityId} className="w-6 h-6" />
                </div>
              </div>
              <p className="text-xs text-stone-300 leading-relaxed">{char.bio}</p>

              <div className="rounded-lg bg-stone-950/80 border border-stone-800 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Signature Ability · Lv.{abilityLevel}/5
                </div>
                <div className="text-sm font-bold text-stone-100 mt-0.5">{char.abilityName}</div>
                <p className="text-xs text-stone-400 mt-0.5">{char.abilityDescription}</p>
              </div>
            </div>

            {isUnlocked ? (
              <button
                type="button"
                disabled={isSelected}
                onClick={() => onSelectCharacter(char.id)}
                className="w-full py-3 rounded-xl font-display font-bold text-sm tracking-wider flex items-center justify-center gap-2 disabled:opacity-70"
                style={{
                  backgroundColor: isSelected ? '#1f2937' : theme.uiAccent,
                  color: isSelected ? '#d6d3d1' : '#0c0a09',
                }}
              >
                <Check className="w-4 h-4" />
                {isSelected ? 'EQUIPPED EXPLORER' : `SELECT ${char.name.toUpperCase()}`}
              </button>
            ) : (
              <button
                type="button"
                disabled={save.coins < char.unlockCost}
                onClick={() => onUnlockCharacter(char.id)}
                className="w-full py-3 rounded-xl font-display font-bold text-sm tracking-wider flex items-center justify-center gap-2 disabled:opacity-45 cursor-pointer"
                style={{ backgroundColor: theme.uiAccent, color: '#0c0a09' }}
              >
                <CoinSvg color="#1c1917" className="w-4 h-4" />
                UNLOCK FOR {char.unlockCost.toLocaleString()} COINS
              </button>
            )}
          </div>
        )}

        {tab === 'outfits' && (
          <div className="space-y-2">
            <p className="text-[11px] text-stone-400">
              Tap any outfit to preview it live in 3D on {char.name}. Outfits never alter gameplay stats.
            </p>
            {outfits.map((o) => {
              const owned = save.unlockedOutfits.includes(o.id);
              const equipped = equippedOutfitId === o.id;
              const isPreviewing = activePreviewOutfit.id === o.id;
              return (
                <div
                  key={o.id}
                  className={`rounded-xl bg-stone-900/85 border p-3 flex items-center justify-between gap-3 transition-colors ${
                    isPreviewing ? 'border-amber-400/80 bg-stone-800/80' : 'border-stone-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setPreviewOutfitId(o.id)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    {/* Material swatch preview */}
                    <div className="w-10 h-10 rounded-lg border border-stone-600 shrink-0 overflow-hidden flex flex-col">
                      <div className="flex-1" style={{ backgroundColor: o.palette.primary }} />
                      <div className="h-2.5 flex">
                        <div className="flex-1" style={{ backgroundColor: o.palette.secondary }} />
                        <div className="flex-1" style={{ backgroundColor: o.palette.accent }} />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-stone-100 truncate">{o.name}</span>
                        <span
                          className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                            RARITY_STYLES[o.rarity]
                          }`}
                        >
                          {o.rarity}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-400 truncate mt-0.5">{o.description}</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={!isUnlocked || (!owned && save.coins < o.price) || equipped}
                    onClick={() => {
                      setPreviewOutfitId(o.id);
                      onEquipOrBuyOutfit(o.id);
                    }}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold shrink-0 disabled:opacity-45 cursor-pointer"
                    style={
                      equipped
                        ? { backgroundColor: '#1f2937', color: '#a8a29e' }
                        : { backgroundColor: theme.uiAccent, color: '#0c0a09' }
                    }
                  >
                    {equipped ? 'Equipped' : owned ? 'Equip' : `${o.price.toLocaleString()}`}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'ability' && (
          <div className="rounded-xl bg-stone-900/85 border border-stone-800 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-stone-950 border border-stone-700 flex items-center justify-center">
                <AbilitySvg abilityId={char.abilityId} className="w-7 h-7" />
              </div>
              <div>
                <h3 className="font-display font-bold text-base text-stone-100">{char.abilityName}</h3>
                <p className="text-xs text-amber-300 font-semibold">
                  Level {abilityLevel} / 5
                </p>
              </div>
            </div>

            <p className="text-xs text-stone-300 leading-relaxed">{char.abilityDescription}</p>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-stone-950/80 border border-stone-800 p-2.5">
                <div className="text-[10px] uppercase text-stone-400 font-bold">Active Duration</div>
                <div className="text-sm font-extrabold text-stone-100 tabular-nums mt-0.5">
                  {getAbilityDurationSec(char.abilityId, abilityLevel).toFixed(1)}s
                </div>
              </div>
              <div className="rounded-lg bg-stone-950/80 border border-stone-800 p-2.5">
                <div className="text-[10px] uppercase text-stone-400 font-bold">Recharge Time</div>
                <div className="text-sm font-extrabold text-stone-100 tabular-nums mt-0.5">
                  {getAbilityCooldownSec(char.abilityId, abilityLevel).toFixed(1)}s
                </div>
              </div>
            </div>

            {abilityLevel < 5 ? (
              <button
                type="button"
                disabled={save.coins < upgradeCost}
                onClick={() => onUpgradeAbility(char.abilityId)}
                className="w-full py-2.5 rounded-xl font-bold text-xs tracking-wider text-stone-950 flex items-center justify-center gap-1.5 disabled:opacity-45 cursor-pointer"
                style={{ backgroundColor: theme.uiAccent }}
              >
                <Sparkles className="w-4 h-4" />
                UPGRADE TO LV.{abilityLevel + 1} · {upgradeCost.toLocaleString()} COINS
              </button>
            ) : (
              <div className="text-center py-2 text-xs font-bold text-emerald-400">
                MAXIMUM ABILITY LEVEL REACHED
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
