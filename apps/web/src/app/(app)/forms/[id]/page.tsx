'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormRespond } from '@/components/forms/form-respond';
import { errorText } from '@/components/teams/ui';
import { useForm } from '@/lib/lists';

/** The link people answer a form at (`/forms/<id>`). Authors see a link back to the editor. */
export default function RespondPage() {
  const { id } = useParams<{ id: string }>();
  const { data: form, isLoading, error } = useForm(id);
  return (
    <section className="min-w-0 flex-1 overflow-y-auto bg-bg p-6">
      <div className="mx-auto max-w-2xl">
        {isLoading && <Loader2 className="animate-spin text-muted" />}
        {!isLoading && !form && <p className="py-10 text-center text-muted">{errorText(error) ?? 'This form is not available.'}</p>}
        {form && (
          <>
            {form.role !== 'respondent' && (
              <p className="mb-3 text-sm"><Link href={`/forms?form=${form.id}`} className="text-brand hover:underline">← Back to the editor</Link></p>
            )}
            <h1 className="text-2xl font-semibold">{form.title}</h1>
            {form.description && <p className="mt-1 mb-4 text-sm whitespace-pre-wrap text-muted">{form.description}</p>}
            <div className="mt-4"><FormRespond form={form} /></div>
          </>
        )}
      </div>
    </section>
  );
}
