import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Recipe } from '@/api/lists'
import { Button } from '@/components/ui'

interface RecipeGroupProps {
  recipe: Recipe
  onDelete: (recipeId: string, removeItems: boolean) => void
  isPending: boolean
  children: ReactNode
}

function isSafeUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function RecipeGroup({ recipe, onDelete, isPending, children }: RecipeGroupProps) {
  const [asking, setAsking] = useState(false)

  return (
    <section className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="flex-1 min-w-0 truncate text-sm font-bold text-text">{recipe.title}</h3>
        {isSafeUrl(recipe.url) && (
          <a
            href={recipe.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open recipe ${recipe.title}`}
            className="p-1.5 rounded-full text-text-muted hover:text-primary hover:bg-text/5 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <path d="M15 3h6v6" />
              <path d="M10 14L21 3" />
            </svg>
          </a>
        )}
        <button
          type="button"
          onClick={() => setAsking(true)}
          disabled={isPending}
          aria-label={`Delete recipe ${recipe.title}`}
          className="p-1.5 rounded-full text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
          </svg>
        </button>
      </div>

      {asking && (
        <div className="mb-2 rounded-xl bg-text/5 p-3 flex flex-col gap-2">
          <p className="text-sm font-medium text-text">Also remove its unchecked items?</p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              onClick={() => {
                onDelete(recipe.id, true)
                setAsking(false)
              }}
              disabled={isPending}
              className="flex-1"
            >
              Remove items
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                onDelete(recipe.id, false)
                setAsking(false)
              }}
              disabled={isPending}
              className="flex-1"
            >
              Keep items
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">{children}</div>
    </section>
  )
}
