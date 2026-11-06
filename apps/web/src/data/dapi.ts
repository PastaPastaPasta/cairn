// Core data over DAPI, through @cairn/dapi: a node pool with failover (nodes from the quorum-service URL or a static list).
// Vendored from govhub apps/web/src/data/dapi.ts (the client factory only).
import { createDapi, type Dapi, type DapiOptions } from '@cairn/dapi';
import type { Network, Registry } from '../config/registry.ts';

export interface DapiConfig {
  source: Registry['dapi']['source'];
  quorumUrl: string;
  nodes: string[];
  network: Network;
}

/**
 * A client for the user's DAPI settings. Pass `verifiers` only where verification runs (the worker): they pull in X11 and BLS,
 * which the page never needs.
 */
export function createWebDapi(cfg: DapiConfig, verifiers?: DapiOptions['verifiers']): Dapi {
  const source: DapiOptions =
    cfg.source === 'quorum'
      ? { nodeListUrl: cfg.quorumUrl }
      : cfg.nodes.length
        ? { nodes: cfg.nodes }
        : { fetchNodes: () => Promise.reject(new Error('no DAPI nodes are configured (Settings, "My own nodes")')) };
  return createDapi({ network: cfg.network, ...source, ...(verifiers ? { verifiers } : {}) });
}

