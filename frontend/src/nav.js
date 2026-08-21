import { Database, BarChart2, Layers, Play, Sparkles } from 'lucide-react'

// roles: which roles can see this nav item
export const ALL_NAV = [
  {
    to: '/metadata', label: 'Metadata & Dictionary', icon: Database, roles: ['data_engineer'],
    desc: 'Define dataset metadata and enrich your data dictionary through a guided, validated setup.',
  },
  {
    to: '/jobrun', label: 'Job Run', icon: Play, roles: ['data_engineer'],
    desc: 'Trigger and monitor pipeline runs, with live task status and logs.',
  },
  {
    to: '/marketplace', label: 'Marketplace', icon: Sparkles, roles: ['data_engineer', 'basic_user'],
    desc: 'Ask a plain-English question and get a live, AI-generated dashboard in seconds.',
  },
  {
    to: '/profiling', label: 'Data Profiling', icon: BarChart2, roles: ['data_engineer'],
    desc: 'Profile a source file to preview structure and quality before configuring a pipeline.',
  },
  {
    to: '/modelling', label: 'Gold Modelling', icon: Layers, roles: ['data_engineer'],
    desc: 'Model curated Silver data into Gold-layer views for reporting and analytics.',
  },
]
