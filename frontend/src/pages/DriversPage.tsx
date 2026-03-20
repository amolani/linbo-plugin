import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderOpen, Upload, Trash2, FileText, ChevronDown, ChevronRight,
  Plus, Save, Loader2, HardDrive, FileArchive, Image as ImageIcon, X,
} from 'lucide-react';
import { driversApi } from '@/api/drivers';
import type { DriverProfile, DriverFileEntry, AvailableImage } from '@/api/drivers';
import { notify } from '@/stores/notificationStore';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

type ExpandedTab = 'files' | 'matchconf' | 'image';

export function DriversPage() {
  const [profiles, setProfiles] = useState<DriverProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const [expandedTab, setExpandedTab] = useState<ExpandedTab>('files');
  const [profileFiles, setProfileFiles] = useState<Record<string, DriverFileEntry[]>>({});
  const [matchConfContent, setMatchConfContent] = useState<Record<string, string>>({});
  const [savingMatchConf, setSavingMatchConf] = useState(false);
  const [uploadingTo, setUploadingTo] = useState<string | null>(null);
  const [extractingTo, setExtractingTo] = useState<string | null>(null);
  const [deletingProfile, setDeletingProfile] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [availableImages, setAvailableImages] = useState<AvailableImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<Record<string, string>>({});
  const [savingImage, setSavingImage] = useState(false);
  const [removingImage, setRemovingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);

  const loadProfiles = useCallback(async () => {
    try {
      setLoading(true);
      const list = await driversApi.listProfiles();
      setProfiles(list);
    } catch (err) {
      notify.error('Fehler', 'Profile konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    driversApi.getAvailableImages().then(setAvailableImages).catch(() => {});
  }, []);

  const loadProfileData = useCallback(async (name: string) => {
    try {
      const [files, conf] = await Promise.all([
        driversApi.getProfileFiles(name),
        driversApi.getMatchConf(name),
      ]);
      setProfileFiles(prev => ({ ...prev, [name]: files }));
      setMatchConfContent(prev => ({ ...prev, [name]: conf.raw }));
    } catch (err) {
      notify.error('Fehler', `Profil-Daten fuer "${name}" konnten nicht geladen werden`);
    }
  }, []);

  const toggleProfile = useCallback((name: string) => {
    if (expandedProfile === name) {
      setExpandedProfile(null);
    } else {
      setExpandedProfile(name);
      setExpandedTab('files');
      if (!profileFiles[name]) {
        loadProfileData(name);
      }
    }
  }, [expandedProfile, profileFiles, loadProfileData]);

  const handleCreateProfile = useCallback(async () => {
    const hostIp = window.prompt('IP-Adresse des LINBO-Clients eingeben:');
    if (!hostIp || !hostIp.trim()) return;

    try {
      setCreatingProfile(true);
      const result = await driversApi.createProfile(hostIp.trim());
      if (result.created) {
        notify.success('Profil erstellt', `${result.vendor} / ${result.folder}`);
      } else {
        notify.info('Profil existiert bereits', result.folder);
      }
      await loadProfiles();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      notify.error('Fehler beim Erstellen', message);
    } finally {
      setCreatingProfile(false);
    }
  }, [loadProfiles]);

  const handleDeleteProfile = useCallback(async (name: string) => {
    if (!window.confirm(`Profil "${name}" und alle darin enthaltenen Dateien wirklich loeschen?`)) return;

    try {
      setDeletingProfile(name);
      await driversApi.deleteProfile(name);
      notify.success('Profil geloescht', name);
      if (expandedProfile === name) setExpandedProfile(null);
      await loadProfiles();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      notify.error('Fehler beim Loeschen', message);
    } finally {
      setDeletingProfile(null);
    }
  }, [expandedProfile, loadProfiles]);

  const handleFileUpload = useCallback(async (profileName: string, file: File) => {
    try {
      setUploadingTo(profileName);
      await driversApi.uploadFile(profileName, file);
      notify.success('Datei hochgeladen', `${file.name} (${formatSize(file.size)})`);
      await loadProfileData(profileName);
      await loadProfiles();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      notify.error('Upload fehlgeschlagen', message);
    } finally {
      setUploadingTo(null);
    }
  }, [loadProfileData, loadProfiles]);

  const handleArchiveExtract = useCallback(async (profileName: string, file: File) => {
    try {
      setExtractingTo(profileName);
      const result = await driversApi.extractArchive(profileName, file);
      notify.success('Archiv extrahiert', `${result.entryCount} Dateien (${formatSize(result.totalUncompressed)})`);
      await loadProfileData(profileName);
      await loadProfiles();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      notify.error('Extraktion fehlgeschlagen', message);
    } finally {
      setExtractingTo(null);
    }
  }, [loadProfileData, loadProfiles]);

  const handleDeleteFile = useCallback(async (profileName: string, filePath: string) => {
    if (!window.confirm(`Datei "${filePath}" wirklich loeschen?`)) return;

    try {
      setDeletingFile(filePath);
      await driversApi.deleteFile(profileName, filePath);
      notify.success('Datei geloescht', filePath);
      await loadProfileData(profileName);
      await loadProfiles();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      notify.error('Fehler beim Loeschen', message);
    } finally {
      setDeletingFile(null);
    }
  }, [loadProfileData, loadProfiles]);

  const handleSaveMatchConf = useCallback(async (profileName: string) => {
    const content = matchConfContent[profileName];
    if (content === undefined) return;

    try {
      setSavingMatchConf(true);
      await driversApi.updateMatchConf(profileName, content);
      notify.success('match.conf gespeichert', profileName);
      await loadProfiles();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      notify.error('Fehler beim Speichern', message);
    } finally {
      setSavingMatchConf(false);
    }
  }, [matchConfContent, loadProfiles]);

  const handleSaveImage = useCallback(async (profileName: string) => {
    const imgValue = selectedImage[profileName];
    try {
      setSavingImage(true);
      if (!imgValue) {
        await driversApi.removeProfileImage(profileName);
        notify.success('Image-Zuordnung entfernt', profileName);
      } else {
        await driversApi.setProfileImage(profileName, imgValue);
        notify.success('Image zugeordnet', `${profileName} → ${imgValue}`);
      }
      await loadProfiles();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      notify.error('Fehler beim Speichern', message);
    } finally {
      setSavingImage(false);
    }
  }, [selectedImage, loadProfiles]);

  const handleRemoveImage = useCallback(async (profileName: string) => {
    try {
      setRemovingImage(true);
      await driversApi.removeProfileImage(profileName);
      setSelectedImage(prev => ({ ...prev, [profileName]: '' }));
      notify.success('Image-Zuordnung entfernt', profileName);
      await loadProfiles();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      notify.error('Fehler beim Entfernen', message);
    } finally {
      setRemovingImage(false);
    }
  }, [loadProfiles]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Treiber-Profile</h1>
          <p className="text-muted-foreground mt-1">
            Jedes Profil ist ein Ordner mit einer match.conf-Datei, die den Hersteller und das Produkt definiert.
            LINBO erkennt die Hardware beim Sync und laedt automatisch die passenden Treiber.
          </p>
        </div>
        <button
          onClick={handleCreateProfile}
          disabled={creatingProfile}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 shrink-0"
        >
          {creatingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Profil erstellen
        </button>
      </div>

      {/* Profile Cards */}
      {profiles.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 text-center text-muted-foreground">
          <HardDrive className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium">Keine Treiber-Profile vorhanden</p>
          <p className="text-sm mt-1">
            Erstellen Sie ein Profil, indem Sie die IP eines laufenden LINBO-Clients angeben.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map(profile => {
            const isExpanded = expandedProfile === profile.folder;

            return (
              <div
                key={profile.folder}
                className={`border rounded-lg bg-card transition-all ${isExpanded ? 'md:col-span-2 lg:col-span-3' : ''}`}
              >
                {/* Card Header */}
                <div
                  className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => toggleProfile(profile.folder)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                      {isExpanded ?
                        <ChevronDown className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" /> :
                        <ChevronRight className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                      }
                      <div className="min-w-0">
                        <h3 className="font-medium text-foreground truncate" title={profile.folder}>
                          {profile.folder}
                        </h3>
                        <p className="text-sm text-muted-foreground truncate">
                          {profile.vendor}{profile.product ? ` / ${profile.product}` : ''}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-3 mt-3 ml-8 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
                      <FileText className="h-3 w-3" />
                      {profile.fileCount} Dateien
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
                      <HardDrive className="h-3 w-3" />
                      {formatSize(profile.totalSize)}
                    </span>
                    {profile.image && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-xs text-blue-600 dark:text-blue-400">
                        <ImageIcon className="h-3 w-3" />
                        {profile.image}
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Footer Actions (always visible) */}
                <div className="border-t px-4 py-2 flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleProfile(profile.folder); setExpandedTab('files'); }}
                    className={`text-xs px-2 py-1 rounded ${isExpanded && expandedTab === 'files' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                  >
                    Dateien
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (expandedProfile !== profile.folder) {
                        setExpandedProfile(profile.folder);
                        if (!profileFiles[profile.folder]) loadProfileData(profile.folder);
                      }
                      setExpandedTab('matchconf');
                    }}
                    className={`text-xs px-2 py-1 rounded ${isExpanded && expandedTab === 'matchconf' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                  >
                    match.conf
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (expandedProfile !== profile.folder) {
                        setExpandedProfile(profile.folder);
                        if (!profileFiles[profile.folder]) loadProfileData(profile.folder);
                      }
                      setExpandedTab('image');
                      if (selectedImage[profile.folder] === undefined) {
                        setSelectedImage(prev => ({ ...prev, [profile.folder]: profile.image || '' }));
                      }
                    }}
                    className={`text-xs px-2 py-1 rounded ${isExpanded && expandedTab === 'image' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                  >
                    Image
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.folder); }}
                    disabled={deletingProfile === profile.folder}
                    className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {deletingProfile === profile.folder ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t p-4">
                    {expandedTab === 'files' && (
                      <div className="space-y-4">
                        {/* Upload Actions */}
                        <div className="flex items-center gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFileUpload(profile.folder, file);
                              e.target.value = '';
                            }}
                          />
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingTo === profile.folder}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted disabled:opacity-50"
                          >
                            {uploadingTo === profile.folder ?
                              <Loader2 className="h-4 w-4 animate-spin" /> :
                              <Upload className="h-4 w-4" />
                            }
                            Datei hochladen
                          </button>

                          <input
                            ref={archiveInputRef}
                            type="file"
                            accept=".zip,.7z,.exe"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleArchiveExtract(profile.folder, file);
                              e.target.value = '';
                            }}
                          />
                          <button
                            onClick={() => archiveInputRef.current?.click()}
                            disabled={extractingTo === profile.folder}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted disabled:opacity-50"
                          >
                            {extractingTo === profile.folder ?
                              <Loader2 className="h-4 w-4 animate-spin" /> :
                              <FileArchive className="h-4 w-4" />
                            }
                            Archiv extrahieren
                          </button>
                        </div>

                        {/* File List */}
                        {!profileFiles[profile.folder] ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : profileFiles[profile.folder].length === 0 ? (
                          <div className="text-center py-6 text-muted-foreground text-sm">
                            <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />
                            Keine Treiber-Dateien vorhanden
                          </div>
                        ) : (
                          <div className="border rounded-md overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/50">
                                <tr>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Datei</th>
                                  <th className="text-right px-3 py-2 font-medium text-muted-foreground w-24">Groesse</th>
                                  <th className="w-12" />
                                </tr>
                              </thead>
                              <tbody>
                                {profileFiles[profile.folder]
                                  .filter(f => !f.isDirectory)
                                  .map(file => (
                                  <tr key={file.path} className="border-t hover:bg-muted/20">
                                    <td className="px-3 py-1.5 font-mono text-xs truncate max-w-md" title={file.path}>
                                      {file.path}
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-muted-foreground text-xs">
                                      {formatSize(file.size)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <button
                                        onClick={() => handleDeleteFile(profile.folder, file.path)}
                                        disabled={deletingFile === file.path}
                                        className="p-1 text-red-400 hover:text-red-600 hover:bg-red-500/10 rounded disabled:opacity-50"
                                        title="Datei loeschen"
                                      >
                                        {deletingFile === file.path ?
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                                          <Trash2 className="h-3.5 w-3.5" />
                                        }
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {expandedTab === 'matchconf' && (
                      /* match.conf Editor */
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          INI-Format mit [match]-Sektion. Definiert vendor und product fuer die automatische Hardware-Erkennung.
                        </p>
                        {matchConfContent[profile.folder] === undefined ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <>
                            <textarea
                              value={matchConfContent[profile.folder] ?? ''}
                              onChange={(e) => setMatchConfContent(prev => ({
                                ...prev,
                                [profile.folder]: e.target.value,
                              }))}
                              className="w-full h-48 font-mono text-sm p-3 border border-border rounded-md bg-background text-foreground resize-y"
                              spellCheck={false}
                            />
                            <div className="flex justify-end">
                              <button
                                onClick={() => handleSaveMatchConf(profile.folder)}
                                disabled={savingMatchConf}
                                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                              >
                                {savingMatchConf ?
                                  <Loader2 className="h-4 w-4 animate-spin" /> :
                                  <Save className="h-4 w-4" />
                                }
                                Speichern
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {expandedTab === 'image' && (
                      /* Image Assignment */
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Ordnen Sie diesem Treiber-Profil ein Image zu. LINBO erstellt automatisch
                          ein Postsync-Script, das nach dem Sync die passenden Treiber installiert.
                        </p>

                        {profile.image && (
                          <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
                            <ImageIcon className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">Aktuell: <strong>{profile.image}</strong></span>
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <select
                            value={selectedImage[profile.folder] ?? profile.image ?? ''}
                            onChange={(e) => setSelectedImage(prev => ({ ...prev, [profile.folder]: e.target.value }))}
                            className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
                          >
                            <option value="">-- Kein Image --</option>
                            {availableImages.map(img => (
                              <option key={img.name} value={img.name}>{img.name}</option>
                            ))}
                          </select>

                          <button
                            onClick={() => handleSaveImage(profile.folder)}
                            disabled={savingImage}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                          >
                            {savingImage ?
                              <Loader2 className="h-4 w-4 animate-spin" /> :
                              <Save className="h-4 w-4" />
                            }
                            Speichern
                          </button>

                          {profile.image && (
                            <button
                              onClick={() => handleRemoveImage(profile.folder)}
                              disabled={removingImage}
                              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-red-300 text-red-500 rounded-md hover:bg-red-500/10 disabled:opacity-50"
                            >
                              {removingImage ?
                                <Loader2 className="h-4 w-4 animate-spin" /> :
                                <X className="h-4 w-4" />
                              }
                              Entfernen
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
