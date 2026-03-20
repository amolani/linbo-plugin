import { useState, useEffect, useCallback } from 'react';
import { Plus, CheckCircle2, RefreshCw, Save, AlertTriangle } from 'lucide-react';
import { imagesApi } from '@/api/images';
import { useDataInvalidation } from '@/hooks/useDataInvalidation';
import { Button, Table, Modal, Input, Textarea, Select, Badge, ConfirmModal } from '@/components/ui';
import { notify } from '@/stores/notificationStore';
import type { Image, Column } from '@/types';

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateString: string | undefined): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Sidecar badge config
const SIDECAR_BADGES = [
  { key: 'hasInfo', label: 'I', title: 'Info (.info)', color: 'bg-primary/20 text-primary' },
  { key: 'hasDesc', label: 'D', title: 'Beschreibung (.desc)', color: 'bg-ciGreen/20 text-ciGreen' },
  { key: 'hasTorrent', label: 'T', title: 'Torrent (.torrent)', color: 'bg-purple-500/20 text-purple-400' },
  { key: 'hasMd5', label: 'M', title: 'Prüfsumme (.md5)', color: 'bg-yellow-500/20 text-yellow-400' },
  { key: 'hasReg', label: 'R', title: 'Registry (.reg)', color: 'bg-orange-500/20 text-orange-400' },
  { key: 'hasPrestart', label: 'P', title: 'Pre-Start Script (.prestart)', color: 'bg-pink-500/20 text-pink-400' },
  { key: 'hasPostsync', label: 'S', title: 'Post-Sync Script (.postsync)', color: 'bg-cyan-500/20 text-cyan-400' },
] as const;

type DetailTab = 'overview' | 'info' | 'desc' | 'reg' | 'scripts';

export function ImagesPage() {
  const [images, setImages] = useState<Image[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingImage, setEditingImage] = useState<Image | null>(null);
  const [deleteConfirmImage, setDeleteConfirmImage] = useState<Image | null>(null);
  const [deleteWithFile, setDeleteWithFile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    filename: '',
    type: 'base',
    description: '',
    backingImage: '',
  });

  // Detail modal state
  const [detailImage, setDetailImage] = useState<Image | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [detailLoading, setDetailLoading] = useState(false);

  // Sidecar editor state
  const [sidecarContent, setSidecarContent] = useState<Record<string, string>>({});
  const [sidecarLoading, setSidecarLoading] = useState<Record<string, boolean>>({});
  const [sidecarSaving, setSidecarSaving] = useState<Record<string, boolean>>({});

  const fetchImages = useCallback(async () => {
    try {
      const data = await imagesApi.list(true);
      setImages(data);
    } catch {
      notify.error('Fehler beim Laden der Images');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const { suppress: suppressImageInvalidation } = useDataInvalidation('image', fetchImages);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  // Load image detail
  const openDetail = async (image: Image) => {
    setDetailImage(null);
    setDetailTab('overview');
    setSidecarContent({});
    setDetailLoading(true);
    try {
      const detail = await imagesApi.get(image.id);
      setDetailImage(detail);
    } catch {
      notify.error('Fehler beim Laden der Image-Details');
    } finally {
      setDetailLoading(false);
    }
  };

  // Load sidecar content
  const loadSidecar = async (imageId: string, type: string) => {
    setSidecarLoading(prev => ({ ...prev, [type]: true }));
    try {
      const data = await imagesApi.getSidecar(imageId, type);
      setSidecarContent(prev => ({ ...prev, [type]: data.content }));
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setSidecarContent(prev => ({ ...prev, [type]: '' }));
      } else {
        notify.error(`Fehler beim Laden von .${type}`);
      }
    } finally {
      setSidecarLoading(prev => ({ ...prev, [type]: false }));
    }
  };

  // Save sidecar content
  const saveSidecar = async (type: string) => {
    if (!detailImage) return;
    setSidecarSaving(prev => ({ ...prev, [type]: true }));
    try {
      await imagesApi.updateSidecar(detailImage.id, type, sidecarContent[type] || '');
      notify.success(`${type} gespeichert`);
      // Reload detail
      const detail = await imagesApi.get(detailImage.id);
      setDetailImage(detail);
      suppressImageInvalidation();
      fetchImages();
    } catch {
      notify.error(`Fehler beim Speichern von .${type}`);
    } finally {
      setSidecarSaving(prev => ({ ...prev, [type]: false }));
    }
  };

  // Load sidecar when switching tabs
  useEffect(() => {
    if (!detailImage) return;
    const typesToLoad: string[] = [];
    if (detailTab === 'desc' && sidecarContent.desc === undefined) typesToLoad.push('desc');
    if (detailTab === 'info' && sidecarContent.info === undefined) typesToLoad.push('info');
    if (detailTab === 'reg' && sidecarContent.reg === undefined) typesToLoad.push('reg');
    if (detailTab === 'scripts') {
      if (sidecarContent.prestart === undefined) typesToLoad.push('prestart');
      if (sidecarContent.postsync === undefined) typesToLoad.push('postsync');
    }
    for (const t of typesToLoad) {
      loadSidecar(detailImage.id, t);
    }
  }, [detailTab, detailImage?.id]);

  const handleOpenModal = (image?: Image) => {
    if (image) {
      setEditingImage(image);
      setFormData({
        filename: image.filename,
        type: image.type,
        description: image.description || '',
        backingImage: image.backingImage || '',
      });
    } else {
      setEditingImage(null);
      setFormData({ filename: '', type: 'base', description: '', backingImage: '' });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      suppressImageInvalidation();
      if (editingImage) {
        await imagesApi.update(editingImage.id, { description: formData.description || undefined });
        notify.success('Image aktualisiert');
      } else {
        await imagesApi.create({
          filename: formData.filename,
          type: formData.type as 'base' | 'differential' | 'rsync',
          description: formData.description || undefined,
          backingImage: formData.backingImage || undefined,
        });
        notify.success('Image erstellt');
      }
      setIsModalOpen(false);
      fetchImages();
    } catch {
      notify.error('Fehler beim Speichern');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmImage) return;
    setIsSubmitting(true);
    try {
      suppressImageInvalidation();
      const url = deleteWithFile
        ? `${deleteConfirmImage.id}?deleteFile=true`
        : deleteConfirmImage.id;
      await imagesApi.delete(url);
      notify.success('Image gelöscht');
      setDeleteConfirmImage(null);
      setDeleteWithFile(false);
      fetchImages();
    } catch {
      notify.error('Fehler beim Löschen');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (imageId: string) => {
    setVerifyingId(imageId);
    try {
      const result = await imagesApi.verify(imageId);
      if (result.valid) {
        notify.success('Prüfsumme gültig', `SHA256: ${result.checksum.substring(0, 16)}...`);
      } else {
        notify.warning('Prüfsumme ungültig');
      }
    } catch {
      notify.error('Fehler bei der Verifizierung');
    } finally {
      setVerifyingId(null);
    }
  };

  const getTypeBadge = (type: string) => {
    const variants: Record<string, 'info' | 'warning' | 'success'> = {
      base: 'info', differential: 'warning', rsync: 'success',
    };
    const labels: Record<string, string> = {
      base: 'Basis', differential: 'Differentiell', rsync: 'Rsync',
    };
    return <Badge variant={variants[type] || 'default'}>{labels[type] || type}</Badge>;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'info' | 'error'> = {
      available: 'success', uploading: 'info', verifying: 'warning', error: 'error',
    };
    const labels: Record<string, string> = {
      available: 'Verfügbar', uploading: 'Hochladen', verifying: 'Verifizieren', error: 'Fehler',
    };
    return <Badge variant={variants[status] || 'default'}>{labels[status] || status}</Badge>;
  };

  const columns: Column<Image>[] = [
    {
      key: 'filename',
      header: 'Dateiname',
      render: (image) => (
        <button
          onClick={() => openDetail(image)}
          className="text-left hover:text-primary transition-colors"
        >
          <div className="font-medium text-foreground">{image.filename}</div>
          <div className="text-muted-foreground text-xs">{image.path}</div>
        </button>
      ),
    },
    {
      key: 'type',
      header: 'Typ',
      render: (image) => getTypeBadge(image.type),
    },
    {
      key: 'size',
      header: 'Größe',
      render: (image) => formatBytes(image.size),
    },
    {
      key: 'sidecars',
      header: 'Dateien',
      render: (image) => {
        if (!image.sidecarSummary) return '-';
        const summary = image.sidecarSummary;
        return (
          <div className="flex gap-0.5 flex-wrap">
            {SIDECAR_BADGES.map(b => {
              const has = summary[b.key as keyof typeof summary];
              if (!has) return null;
              return (
                <span
                  key={b.key}
                  title={b.title}
                  className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold ${b.color}`}
                >
                  {b.label}
                </span>
              );
            })}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (image) => getStatusBadge(image.status),
    },
    {
      key: 'uploadedAt',
      header: 'Hochgeladen',
      render: (image) => formatDate(image.uploadedAt || image.createdAt),
    },
    {
      key: 'actions',
      header: 'Aktionen',
      render: (image) => (
        <div className="flex space-x-2">
          <button
            onClick={() => handleVerify(image.id)}
            className="text-primary hover:text-primary/80"
            title="Verifizieren"
            disabled={verifyingId === image.id}
          >
            {verifyingId === image.id ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => handleOpenModal(image)}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Bearbeiten
          </button>
          <button
            onClick={() => setDeleteConfirmImage(image)}
            className="text-destructive hover:text-destructive/80 text-sm"
          >
            Löschen
          </button>
        </div>
      ),
    },
  ];

  // Detail Modal Tab Content
  const renderDetailTab = () => {
    if (!detailImage) return null;

    switch (detailTab) {
      case 'overview':
        return (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="text-muted-foreground">Dateiname</div>
              <div className="font-mono">{detailImage.filename}</div>
              <div className="text-muted-foreground">Typ</div>
              <div>{getTypeBadge(detailImage.type)}</div>
              <div className="text-muted-foreground">Status</div>
              <div>{getStatusBadge(detailImage.status)}</div>
              <div className="text-muted-foreground">Größe (DB)</div>
              <div>{formatBytes(detailImage.size)}</div>
              {detailImage.fileSize != null && (
                <>
                  <div className="text-muted-foreground">Größe (Datei)</div>
                  <div>{formatBytes(detailImage.fileSize)}</div>
                </>
              )}
              <div className="text-muted-foreground">Pfad</div>
              <div className="font-mono text-xs break-all">{detailImage.absolutePath || detailImage.path}</div>
              {detailImage.checksum && (
                <>
                  <div className="text-muted-foreground">Prüfsumme</div>
                  <div className="font-mono text-xs break-all">{detailImage.checksum}</div>
                </>
              )}
              <div className="text-muted-foreground">Hochgeladen</div>
              <div>{formatDate(detailImage.uploadedAt)}</div>
              <div className="text-muted-foreground">Erstellt von</div>
              <div>{detailImage.createdBy || '-'}</div>
              {detailImage.backingImage && (
                <>
                  <div className="text-muted-foreground">Basis-Image</div>
                  <div className="font-mono">{detailImage.backingImage}</div>
                </>
              )}
            </div>

            {/* Sidecar files */}
            {detailImage.sidecars && (
              <div className="mt-4">
                <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Sidecar-Dateien</h4>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {Object.entries(detailImage.sidecars).map(([type, sc]) => (
                    <div key={type} className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${sc.exists ? 'bg-ciGreen' : 'bg-gray-600'}`} />
                      <span className="font-mono">.{type}</span>
                      {sc.exists && sc.size != null && (
                        <span className="text-muted-foreground">{formatBytes(sc.size)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Used by */}
            {(detailImage as unknown as { usedBy?: { configName: string; osName: string; usage: string }[] }).usedBy?.length ? (
              <div className="mt-4">
                <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Verwendet von</h4>
                <div className="space-y-1 text-xs">
                  {(detailImage as unknown as { usedBy: { configName: string; osName: string; usage: string }[] }).usedBy.map((u, i) => (
                    <div key={i} className="flex gap-2">
                      <Badge variant="default">{u.usage}</Badge>
                      <span>{u.configName} / {u.osName}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        );

      case 'info':
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Metadaten aus der .info-Datei (wird vom Client beim Upload erzeugt, nur lesbar)
            </p>
            {sidecarLoading.info ? (
              <div className="text-muted-foreground text-sm">Laden...</div>
            ) : detailImage.imageInfo ? (
              <div className="bg-muted/50 rounded p-3 font-mono text-xs space-y-1">
                {Object.entries(detailImage.imageInfo).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="text-muted-foreground min-w-[120px]">{key}</span>
                    <span>{String(value)}</span>
                  </div>
                ))}
              </div>
            ) : sidecarContent.info !== undefined ? (
              <pre className="bg-muted/50 rounded p-3 font-mono text-xs whitespace-pre-wrap">{sidecarContent.info || '(leer)'}</pre>
            ) : (
              <div className="text-muted-foreground text-sm">Keine .info-Datei vorhanden</div>
            )}
          </div>
        );

      case 'desc':
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Beschreibung / Changelog des Images. Wird auch in der .desc-Datei gespeichert.
            </p>
            {sidecarLoading.desc ? (
              <div className="text-muted-foreground text-sm">Laden...</div>
            ) : (
              <>
                <textarea
                  className="w-full h-48 bg-muted/50 rounded p-3 font-mono text-xs border border-border focus:border-primary focus:outline-none resize-y"
                  value={sidecarContent.desc ?? ''}
                  onChange={(e) => setSidecarContent(prev => ({ ...prev, desc: e.target.value }))}
                  placeholder="Beschreibung eingeben..."
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => saveSidecar('desc')}
                    loading={sidecarSaving.desc}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Speichern
                  </Button>
                </div>
              </>
            )}
          </div>
        );

      case 'reg':
        return (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 rounded p-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>Registry-Patches werden auf Windows-Clients beim Sync angewendet.</span>
            </div>
            {sidecarLoading.reg ? (
              <div className="text-muted-foreground text-sm">Laden...</div>
            ) : (
              <>
                <textarea
                  className="w-full h-48 bg-muted/50 rounded p-3 font-mono text-xs border border-border focus:border-primary focus:outline-none resize-y"
                  value={sidecarContent.reg ?? ''}
                  onChange={(e) => setSidecarContent(prev => ({ ...prev, reg: e.target.value }))}
                  placeholder="Windows Registry Editor Version 5.00&#10;&#10;[HKEY_LOCAL_MACHINE\...]"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => saveSidecar('reg')}
                    loading={sidecarSaving.reg}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Speichern
                  </Button>
                </div>
              </>
            )}
          </div>
        );

      case 'scripts':
        return (
          <div className="space-y-6">
            <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 rounded p-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>Scripts laufen auf dem LINBO-Client. Änderungen mit Vorsicht vornehmen.</span>
            </div>

            {/* Pre-Start Script */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Pre-Start Script (.prestart)</h4>
              <p className="text-xs text-muted-foreground">Wird vor dem Start des Betriebssystems ausgeführt.</p>
              {sidecarLoading.prestart ? (
                <div className="text-muted-foreground text-sm">Laden...</div>
              ) : (
                <>
                  <textarea
                    className="w-full h-32 bg-muted/50 rounded p-3 font-mono text-xs border border-border focus:border-primary focus:outline-none resize-y"
                    value={sidecarContent.prestart ?? ''}
                    onChange={(e) => setSidecarContent(prev => ({ ...prev, prestart: e.target.value }))}
                    placeholder="#!/bin/bash&#10;# Pre-Start Script"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => saveSidecar('prestart')}
                      loading={sidecarSaving.prestart}
                    >
                      <Save className="h-3 w-3 mr-1" />
                      Speichern
                    </Button>
                  </div>
                </>
              )}
            </div>

            {/* Post-Sync Script */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Post-Sync Script (.postsync)</h4>
              <p className="text-xs text-muted-foreground">Wird nach dem Sync des Betriebssystems ausgeführt.</p>
              {sidecarLoading.postsync ? (
                <div className="text-muted-foreground text-sm">Laden...</div>
              ) : (
                <>
                  <textarea
                    className="w-full h-32 bg-muted/50 rounded p-3 font-mono text-xs border border-border focus:border-primary focus:outline-none resize-y"
                    value={sidecarContent.postsync ?? ''}
                    onChange={(e) => setSidecarContent(prev => ({ ...prev, postsync: e.target.value }))}
                    placeholder="#!/bin/bash&#10;# Post-Sync Script"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => saveSidecar('postsync')}
                      loading={sidecarSaving.postsync}
                    >
                      <Save className="h-3 w-3 mr-1" />
                      Speichern
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
    }
  };

  const tabItems: { key: DetailTab; label: string }[] = [
    { key: 'overview', label: 'Übersicht' },
    { key: 'info', label: 'Info' },
    { key: 'desc', label: 'Beschreibung' },
    { key: 'reg', label: 'Registry' },
    { key: 'scripts', label: 'Scripts' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Images</h1>
          <p className="text-muted-foreground">Verwaltung der System-Images</p>
        </div>
        <Button onClick={() => handleOpenModal()}>
          <Plus className="h-5 w-5 mr-2" />
          Neues Image
        </Button>
      </div>

      <div className="bg-card shadow-sm rounded-lg overflow-hidden">
        <Table
          columns={columns}
          data={images}
          keyExtractor={(image) => image.id}
          loading={isLoading}
          emptyMessage="Keine Images gefunden"
        />
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingImage ? 'Image bearbeiten' : 'Neues Image'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editingImage && (
            <>
              <Input
                label="Dateiname"
                required
                placeholder="ubuntu22.qcow2"
                value={formData.filename}
                onChange={(e) => setFormData({ ...formData, filename: e.target.value })}
              />
              <Select
                label="Typ"
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                options={[
                  { value: 'base', label: 'Basis-Image' },
                  { value: 'differential', label: 'Differentielles Image' },
                  { value: 'rsync', label: 'Rsync-Image' },
                ]}
              />
              {formData.type === 'differential' && (
                <Input
                  label="Basis-Image"
                  placeholder="base-image.qcow2"
                  value={formData.backingImage}
                  onChange={(e) => setFormData({ ...formData, backingImage: e.target.value })}
                />
              )}
            </>
          )}
          <Textarea
            label="Beschreibung"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>
              Abbrechen
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editingImage ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteConfirmImage}
        onClose={() => { setDeleteConfirmImage(null); setDeleteWithFile(false); }}
        onConfirm={handleDelete}
        title="Image löschen"
        message={
          <div className="space-y-3">
            <p>Möchten Sie das Image &quot;{deleteConfirmImage?.filename}&quot; wirklich löschen?</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deleteWithFile}
                onChange={(e) => setDeleteWithFile(e.target.checked)}
                className="rounded border-border"
              />
              <span>Dateien auf dem Server löschen (inkl. Backups)</span>
            </label>
            {deleteWithFile && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded p-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>Das gesamte Image-Verzeichnis wird unwiderruflich gelöscht!</span>
              </div>
            )}
          </div>
        }
        confirmLabel="Löschen"
        variant="danger"
        loading={isSubmitting}
      />

      {/* Detail Modal */}
      <Modal
        isOpen={!!detailImage || detailLoading}
        onClose={() => { setDetailImage(null); setSidecarContent({}); }}
        title={detailImage ? detailImage.filename : 'Image-Details'}
        size="lg"
      >
        {detailLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : detailImage ? (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex border-b border-border">
              {tabItems.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setDetailTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    detailTab === tab.key
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="min-h-[200px]">
              {renderDetailTab()}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
