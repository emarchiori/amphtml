/**
 * Copyright 2018 The AMP HTML Authors. All Rights Reserved.
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

import {AmpNextPage} from '../amp-next-page';
import {Services} from '../../../../src/services';
import {examplePage} from './example-page';
import {getServiceForDoc} from '../../../../src/service';
import {layoutRectLtwh} from '../../../../src/layout-rect';
import {macroTask} from '../../../../testing/yield';
import {toggleExperiment} from '../../../../src/experiments';

describes.realWin('amp-next-page component', {
  amp: {
    extensions: ['amp-next-page'],
  },
},
env => {
  let win, doc, ampdoc;
  let element;
  let nextPage;
  let xhrMock;
  let positionObserverMock;
  let viewport;
  let sizes;

  beforeEach(() => {
    win = env.win;
    doc = win.document;
    ampdoc = env.ampdoc;
    viewport = Services.viewportForDoc(ampdoc);
    sizes = viewport.getSize();

    toggleExperiment(win, 'amp-next-page', true);

    element = doc.createElement('div');
    element.innerHTML = `
          <script type="application/json">
            {
              "pages": [
                {
                  "image": "/examples/img/hero@1x.jpg",
                  "title": "Title 1",
                  "ampUrl": "/document1"
                },
                {
                  "image": "/examples/img/hero@1x.jpg",
                  "title": "Title 2",
                  "ampUrl": "/document2"
                }
              ]
            }
          </script>`;
    element.getAmpDoc = () => ampdoc;
    element.getFallback = () => null;
    element.getResources = () => win.services.resources.obj;

    nextPage = new AmpNextPage(element);
    doc.body.appendChild(element);

    // sourceUrl is set to about:srcdoc, which has no host.
    sandbox.stub(Services.documentInfoForDoc(element), 'sourceUrl').value('/');

    nextPage.buildCallback();

    xhrMock = sandbox.mock(Services.xhrFor(win));
    positionObserverMock =
        sandbox.mock(getServiceForDoc(ampdoc, 'position-observer'));

    sandbox.stub(Services.resourcesForDoc(ampdoc), 'mutateElement')
        .callsFake((unused, mutator) => {
          mutator();
          return Promise.resolve();
        });
  });

  afterEach(() => {
    xhrMock.verify();
  });

  afterEach(() => {
    toggleExperiment(win, 'amp-next-page', false);
  });

  it('does not fetch the next document before 3 viewports away', function* () {
    xhrMock.expects('fetchDocument').never();
    sandbox.stub(viewport, 'getClientRectAsync').callsFake(() => {
      // 4x viewports away
      return Promise.resolve(
          layoutRectLtwh(0, 0, sizes.width, sizes.height * 5));
    });

    win.dispatchEvent(new Event('scroll'));
    yield macroTask();
  });

  it('fetches the next document within 3 viewports away', function* () {
    xhrMock.expects('fetchDocument')
        .returns(Promise.resolve({
          body() {
            return '';
          },
        }));

    sandbox.stub(viewport, 'getClientRectAsync').callsFake(() => {
      // 1x viewport away
      return Promise.resolve(
          layoutRectLtwh(0, 0, sizes.width, sizes.height * 2));
    });

    win.dispatchEvent(new Event('scroll'));
    yield macroTask();
  });

  it('only fetches the next document once', function*() {
    xhrMock.expects('fetchDocument')
        // Promise which is never resolved.
        .returns(new Promise(() => {}))
        .once();

    sandbox.stub(viewport, 'getClientRectAsync').callsFake(() => {
      // 1x viewport away
      return Promise.resolve(
          layoutRectLtwh(0, 0, sizes.width, sizes.height * 2));
    });

    win.dispatchEvent(new Event('scroll'));
    yield macroTask();
    win.dispatchEvent(new Event('scroll'));
    yield macroTask();
  });

  it.skip('updates title/URL when the next document comes into view', function*() {
    xhrMock.expects('fetchDocument')
        .returns(Promise.resolve({
          body() {
            return examplePage;
          },
        }));

    element.style.marginTop = '1000px';

    // Trigger document fetch
    // const viewportStub = sandbox.stub(viewport, 'getClientRectAsync');
    // viewportStub.withArgs(element)
    //     .onFirstCall()
    //     .returns(
    //         // 1x viewport away from end of content, to trigger next document
    //         // fetch+render.
    //         Promise.resolve(
    //             layoutRectLtwh(0, 0, sizes.width, sizes.height * 2)))
    //     .onSecondCall()
    //     .returns(
    //         // 4x viewports away from end of content, to stop any more articles
    //         // from being fetched.
    //         Promise.resolve(
    //             layoutRectLtwh(0, 0, sizes.width, sizes.height * 5)));
    // viewportStub.onFirstCall().returns(
    //     // but this is gonna get called for multiple rec units... :/
    //     Promise.resolve(layoutRectLtwh(0, 0, sizes.width, sizes.height * 2)));

    // TODO do scroll to fetch document/render
    // TODO assert current title
    // TODO trigger a thing on positionobserver
    //   OR stub out getClientRectAsync again and trigger some scrolls
    // TODO assert new title
    // TODO assert analytics?

    win.scrollTo(0, 1000);
    win.dispatchEvent(new Event('scroll'));
    yield macroTask();
    yield macroTask();

    expect(doc.title).to.equal('');

    win.scrollTo(0, 1200);
    win.dispatchEvent(new Event('scroll'));
    yield macroTask();
    yield macroTask();
    yield macroTask();
    yield macroTask();
    yield macroTask();

    expect(doc.title).to.equal('Title 1');
  });

  it('hides position fixed elements from subsequent pages', () => {
    // TODO
  });
});
