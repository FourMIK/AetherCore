/**
 * NodeListPanel
 * Sortable/filterable node list with domain and status filters
 */

import React, { useState, useMemo } from 'react';
import { Search, Filter } from 'lucide-react';
import { GlassPanel } from '../hud/GlassPanel';
import { useTacticalStore } from '../../store/useTacticalStore';

export const NodeListPanel: React.FC = () => {
  const nodes = useTacticalStore((s) => s.nodes);
  const selectedNodeId = useTacticalStore((s) => s.selectedNodeId);
  const selectNode = useTacticalStore((s) => s.selectNode);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'degraded'>('all');
  const [domainFilter, setDomainFilter] = useState('');

  const filteredNodes = useMemo(() => {
    let filtered = Array.from(nodes.values());

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (node) =>
          node.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
          node.domain.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((node) => node.status === statusFilter);
    }

    // Domain filter
    if (domainFilter) {
      filtered = filtered.filter((node) =>
        node.domain.toLowerCase().includes(domainFilter.toLowerCase())
      );
    }

    return filtered;
  }, [nodes, searchTerm, statusFilter, domainFilter]);

  const getStatusBadge = (status: string) => {
    const badges = {
      online: 'badge-success',
      offline: 'badge-danger',
      degraded: 'badge-warning',
    };
    return badges[status as keyof typeof badges] || 'badge-info';
  };

  return (
    <GlassPanel variant="default" className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-tungsten/10">
        <h3 className="font-display text-lg font-semibold text-tungsten mb-4">
          Node List
        </h3>

        {/* Search */}
        <div className="relative mb-3">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-tungsten/50"
            size={16}
          />
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-sm text-tungsten focus:outline-none focus:border-overmatch"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="flex-1 px-3 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-sm text-tungsten focus:outline-none focus:border-overmatch"
          >
            <option value="all">All Status</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="degraded">Degraded</option>
          </select>

          <input
            type="text"
            placeholder="Domain..."
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="flex-1 px-3 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-sm text-tungsten focus:outline-none focus:border-overmatch"
          />
        </div>
      </div>

      {/* Node List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filteredNodes.length === 0 ? (
          <div className="text-center text-tungsten/50 py-8">
            <Filter size={32} className="mx-auto mb-2" />
            <p className="text-sm">No nodes found</p>
          </div>
        ) : (
          filteredNodes.map((node) => (
            <GlassPanel
              key={node.id}
              variant="light"
              className={`p-3 cursor-pointer transition-colors ${
                selectedNodeId === node.id ? 'border-overmatch' : ''
              }`}
              onClick={() => selectNode(node.id)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-sm text-tungsten">{node.id}</span>
                <span className={getStatusBadge(node.status)}>
                  {node.status.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-tungsten/70">
                <span>{node.domain}</span>
                <span className={node.verified ? 'text-verified-green' : 'text-ghost'}>
                  {node.verified ? 'Verified' : 'Unverified'}
                </span>
              </div>
              <div className="mt-2">
                <div className="trust-gauge">
                  <div
                    className={`trust-gauge-fill ${
                      node.trustScore >= 80 ? 'high' : node.trustScore >= 50 ? 'medium' : 'low'
                    }`}
                    style={{ width: `${node.trustScore}%` }}
                  />
                </div>
              </div>
            </GlassPanel>
          ))
        )}
      </div>
    </GlassPanel>
  );
};
