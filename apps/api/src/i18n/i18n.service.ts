import { Injectable } from '@nestjs/common';
import { Language } from '../../generated/prisma';
import en from './locales/en.json';
import fr from './locales/fr.json';

type Catalog = Record<string, unknown>;

@Injectable()
export class I18nService {
  private readonly catalogs: Record<Language, Catalog> = {
    EN: en,
    FR: fr,
  };

  t(key: string, lang: Language, params?: Record<string, string>): string {
    const template =
      this.resolve(this.catalogs[lang], key) ?? this.resolve(this.catalogs.EN, key) ?? key;
    return this.interpolate(template, params);
  }

  private resolve(catalog: Catalog, key: string): string | undefined {
    let current: unknown = catalog;

    for (const part of key.split('.')) {
      if (typeof current !== 'object' || current === null) {
        return undefined;
      }
      current = (current as Catalog)[part];
    }

    return typeof current === 'string' ? current : undefined;
  }

  private interpolate(template: string, params?: Record<string, string>): string {
    if (!params) {
      return template;
    }
    return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => params[name] ?? match);
  }
}
