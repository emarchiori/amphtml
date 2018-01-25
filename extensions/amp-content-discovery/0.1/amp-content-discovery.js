/**
 * Copyright 2017 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** @const */
const EXPERIMENT = 'amp-content-discovery';

/** @const */
const TAG = 'amp-content-discovery';

/** @const */
const MAX_ARTICLES = 2;

/** @const */
const XHR_TIMEOUT = 2000;


import {assertConfig} from './config';
import {user, dev} from '../../../src/log';
import {MultidocManager} from '../../../src/runtime';
import {tryParseJson} from '../../../src/json';
import {CSS} from '../../../build/amp-content-discovery-0.1.css';
import {isJsonScriptTag} from '../../../src/dom';
import {createLoaderElement} from '../../../src/loader';
import {Services} from '../../../src/services';
import {triggerAnalyticsEvent} from '../../../src/analytics';


/**
 * @param {string} url
 * @return {!Promise<!Document>}
 */
function fetchDocument(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'document';
    xhr.setRequestHeader('Accept', 'text/html');
    xhr.timeout = XHR_TIMEOUT;
    xhr.onreadystatechange = () => {
      if (xhr.readyState != /* COMPLETE */ 4) {
        return;
      }
      if (xhr.status == 200) {
        if (xhr.responseXML) {
          resolve(xhr.responseXML);
        } else {
          reject(new Error(`No xhr.responseXML`));
        }
        return;
      }
      xhr.onreadystatechange = null;
      reject(new Error(`HTTP status ${xhr.status}`));
    };
    xhr.onerror = () => {
      reject(new Error('Network failure'));
    };
    xhr.onabort = () => {
      reject(new Error('Request aborted'));
    };
    xhr.send();
  });
}

class AmpContentDiscovery extends AMP.BaseElement {
  /** @param {!AmpElement} element */
  constructor(element) {
    super(element);

    this.element.classList.add('amp-content-discovery');

    if (this.win.CONTENT_DISCOVERY) {
      return;
    }
    this.win.CONTENT_DISCOVERY = this;

    /** @private {?AmpContentDiscoveryConfig} */
    this.config_;

    this.nextArticle = 0;

    this.nextUrl_;

    this.intersectionObserver_;

    const ampReadyPromise = new Promise(resolve => {
      (window.AMP = window.AMP || []).push(resolve);
    });
    ampReadyPromise.then(AMP => {
      this.multidocManager_ = new MultidocManager(
          this.win,
          Services.ampdocServiceFor(this.win),
          Services.extensionsFor(this.win),
          Services.timerFor(this.win));
    });

    this.multidocManager_;

    this.loadingElement_;

    this.readyPromise_ = Promise.all([
      ampReadyPromise
    ]).then(results => results[0]);
  }

  attachShadowDoc(doc, url) {
    this.getVsync().mutate(() => {
      const shadowRoot = this.win.document.createElement('div');
      shadowRoot.classList.add('amp-next-article-container');

      try {
        const amp = this.multidocManager_.attachShadowDoc(shadowRoot, doc, '', {});

        // TODO(emarchiori): Update document title.
        // TODO(emarchiori): Deal with position fixed elements.

        this.element.appendChild(shadowRoot);
        this.element.removeChild(this.loadingElement_);
        this.win.CONTENT_DISCOVERY.appendNextArticle();
        this.triggerAnalyticsEvent_('amp-content-discovery-scroll', url);

        // var viewport = Services.viewportForDoc(amp.ampdoc);
        
        // TODO(emarchiori): Add it from a CSS file.
        const css = '.inactive-doc > *[i-amphtml-fixedid] { display: none; }';
        const head = amp.ampdoc.getHeadNode();
        const body = amp.ampdoc.getBody();
        body.classList.add('inactive-doc');
        const style = doc.createElement('style');

        style.type = 'text/css';
        style.appendChild(doc.createTextNode(css));
        head.appendChild(style);

      } catch(e) {
        this.handleLoadingError();
      }
    });
  }


  handleLoadingError(url, error) {
    user().error(TAG, 'Failed to fetch: ', url, error);

    this.getVsync().mutate(() => {
      this.element.removeChild(this.loadingElement_);
      const failElement = this.win.document.createElement('div');
      failElement.classList.add('fail-element');
      this.element.appendChild(failElement);
      this.appendNextArticle(true);
    });
  }

  ioCallback_(entries, observer) { 
    const url = this.nextUrl_;

    if (url && entries[0].isIntersecting) {
      this.nextUrl_ = undefined;

      fetchDocument(url).then(
        (doc) => {window.setTimeout(() => {this.attachShadowDoc(doc, url);}, 500)},
        (error) => {this.handleLoadingError(url, error);})
    }
  }

  createNextArticleHeader(doc, image, title) {
    const header = doc.createElement('div');
    header.classList.add('header');

    const imageElement = doc.createElement('div');
    imageElement.classList.add('header-image');
    imageElement.style.backgroundImage = 'url(' + image + ')';
    header.appendChild(imageElement);

    const titleElement = doc.createElement('div');
    titleElement.classList.add('header-title');
    titleElement.textContent = title;
    header.appendChild(titleElement);

    return header;
  }

  /**
   * @param {string} eventType
   * @param {string} toURL The new url after the event.
   * @private
   */
  triggerAnalyticsEvent_(eventType, toURL) {
    // TODO(emarchiori): Should probaly set the fromURL as well.
    const vars = {
      'toURL': toURL
    };
    triggerAnalyticsEvent(this.element, eventType, vars);
  }

  appendNextArticle(wrapUp) {
    const AMP = this.win.AMP;
    const doc = this.win.document;
    const viewer = Services.viewerForDoc(this.getAmpDoc());

    const joint = doc.createElement('div');
    joint.classList.add('joint');
    this.element.appendChild(joint);   

    const bottomBorder = doc.createElement('div');
    bottomBorder.classList.add('bottom-article-border');
    joint.appendChild(bottomBorder);  

    const jointContent = doc.createElement('div');
    jointContent.classList.add('joint-content');
    joint.appendChild(jointContent);   

    if (!wrapUp && this.nextArticle < MAX_ARTICLES && this.nextArticle < this.config_.recos.length) {
      const next = this.config_.recos[this.nextArticle];
      this.nextArticle++;
      
      joint.appendChild(this.createNextArticleHeader(doc, next.image, next.title));

      this.element.appendChild(this.loadingElement_);   
      if (!this.intersectionObserver_) {

        // TODO(emarchiori): Should not just load everything on build.

        fetchDocument(next.ampUrl).then(this.attachShadowDoc.bind(this),
          (error) => {this.handleLoadingError(next.ampUrl, error);})
      } else {
        this.nextUrl_ = next.ampUrl;
      }

    } else if (this.nextArticle < this.config_.recos.length) { 

      const recoHolder = doc.createElement('div');
      recoHolder.classList.add('reco-holder');
      let article = this.nextArticle;
      while (article < this.config_.recos.length) {
        const next = this.config_.recos[article];
        article++;

        const articleHolder = doc.createElement('div');
        if (article == this.config_.recos.length) {
          articleHolder.classList.add('reco-holder-article-last');
        } else {
          articleHolder.classList.add('reco-holder-article');
        }
        articleHolder.onclick = () => {
          this.triggerAnalyticsEvent_('amp-content-discovery-click', next.ampUrl);
          viewer.navigateTo(next.ampUrl, 'content-discovery');
        }

        const imageElement = doc.createElement('div');
        imageElement.classList.add('next-article-image');
        imageElement.style.backgroundImage = 'url(' + next.image + ')';
        articleHolder.appendChild(imageElement);

        const titleElement = doc.createElement('div');
        titleElement.classList.add('next-article-title');
        titleElement.textContent = next.title;
        articleHolder.appendChild(titleElement);


        recoHolder.appendChild(articleHolder);
      }
      joint.appendChild(recoHolder);

      const bottomMargin = doc.createElement('div');
      bottomMargin.classList.add('bottom-margin');
      joint.appendChild(bottomMargin); 
    } else if (wrapUp) {
      const bottomMargin = doc.createElement('div');
      bottomMargin.classList.add('bottom-margin');
      joint.appendChild(bottomMargin); 
    }
  }

  addUnfoldElement() {
    const unfoldElement = this.win.document.createElement('div');
    unfoldElement.classList.add('article-unfold');
    this.element.appendChild(unfoldElement);   

    const keepReading = this.win.document.createElement('div');
    keepReading.classList.add('keep-reading-button');
    unfoldElement.appendChild(keepReading);   

    keepReading.onclick = () => {
      this.getVsync().mutate(() => {
        let child = this.element.firstChild;
        while (child) {
          if (child.toggleLayoutDisplay) {
            child.toggleLayoutDisplay(true);
          } else if (child.style) {
            child.style.display = '';
          }
          child = child.nextSibling;
        }

        this.element.removeChild(unfoldElement);
      });
    };
  }

  /** @override */
  isLayoutSupported(layout) {
    return true;
  }


  collapseNextSiblings() {
    let child = this.element.nextElementSibling;
    while (child) {
      if (child.collapse) {
        child.collapse();
      } else if (child.style) {
        child.style.display = 'none';        
      }
      this.element.appendChild(child);
      child = this.element.nextElementSibling;
    }
  };

  /** @override */
  buildCallback() {
    const children = this.element.children;
    user().assert(children.length == 1,
        'The tag should contain exactly one <script> child.');
    const scriptElement = children[0];
    user().assert(
        isJsonScriptTag(scriptElement),
        'The amp-content-discovery config should ' +
        'be inside a <script> tag with type="application/json"');

    if (this.win.CONTENT_DISCOVERY != this) {
      const mutatePromise = this.mutateElement(() => {
        this.collapseNextSiblings();
        this.addUnfoldElement();
      });

      return mutatePromise;
    }

    const doc = this.win.document;

    this.loadingElement_ = doc.createElement('div');
    this.loadingElement_.classList.add('article-loading');

    const dots = createLoaderElement(doc, 'amp-content-discovery');
    dots.classList.add('amp-active');
    this.loadingElement_.appendChild(dots);

    if ('IntersectionObserver' in this.win) {
      this.intersectionObserver_ = new this.win['IntersectionObserver'](this.ioCallback_.bind(this), {threshold: 0.1});
      this.intersectionObserver_.observe(this.loadingElement_);
    }

    const configJson = tryParseJson(scriptElement.textContent, error => {
      throw user().createError('failed to parse content discovery script', error);
    });

    this.config_ = assertConfig(configJson);

    const mutatePromise = this.mutateElement(() => {
      this.collapseNextSiblings();
      this.addUnfoldElement();
      this.appendNextArticle();
    });

    return Promise.all([this.readyPromise_,
      mutatePromise]);
  }
}


AMP.registerElement('amp-content-discovery', AmpContentDiscovery, CSS);